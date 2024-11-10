async function getUserRepos(github, username) {
  const userRepos = await github.rest.repos.listForUser({
    username,
    type: "all",
    per_page: 1000,
  });
  const repoDetails = await Promise.all(
    userRepos.data.map(async (repo) => {
      return {
        name: repo.full_name,
        owner: repo.owner.login,
        stars: repo.stargazers_count,
        forks: repo.forks_count,
        isForked: repo.fork,
        pullRequests: 0,
        parent: repo.parent,
      };
    })
  );

  return repoDetails;
}

async function getUserRepoDetails(github, userRepos, username) {
  const originalRepos = userRepos.filter((repo) => !repo.isForked);
  const forkedRepos = userRepos.filter((repo) => repo.isForked);

  for (const repo of forkedRepos) {
    if (!repo.parent) {
      console.log("No parent found for forked repo", repo.name, repo);
    }
    const sourceRepo = repo?.parent?.full_name ?? repo.name;
    const [owner, repoName] = sourceRepo.split("/");
    const { data: pullRequests } = await github.rest.pulls
      .list({
        owner,
        repo: repoName,
        state: "all",
        per_page: 100,
      })
      .catch(() => ({ data: [] }));

    const userPullRequests = pullRequests.filter(
      (pr) => pr.user?.login === username
    );

    repo.pullRequests = userPullRequests.length;
  }
  return { originalRepos, forkedRepos };
}

async function getRecentEvents(github, username, since = null) {
  if (!since) {
    since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  }
  const uniqueRepoCount = new Set();
  const repoIssues = new Map();

  const events = [];
  let page = 1;
  let hasMore = true;
  var count = 0;

  while (hasMore) {
    const { data: paginatedEvents } =
      await github.rest.activity.listPublicEventsForUser({
        username,
        per_page: 100,
        page,
      });

    events.push(...paginatedEvents);
    page++;
    count += paginatedEvents.length;
    if (count >= 300) {
      break;
    }
    hasMore = events.length === 100;
  }

  for (const event of events) {
    const repoFullName = event.repo.name;
    const [owner, repo] = repoFullName.split("/");
    uniqueRepoCount.add(repoFullName);
    const { data: commits } = await github.rest.repos
      .listCommits({
        owner,
        repo,
        author: username,
        since,
        per_page: 100,
      })
      .catch(() => ({ data: [] }));

    // Get issues created by user
    const { data: issues } = await github.rest.issues
      .listForRepo({
        owner,
        repo,
        since,
        state: "all",
        per_page: 100,
      })
      .catch(() => ({ data: [] }));

    const userIssues = issues.filter((issue) => issue.user?.login === username);
    if (userIssues.length > 0) {
      if (!repoIssues.has(repoFullName)) {
        repoIssues.set(repoFullName, {
          commits: commits.length,
          issues: userIssues.length,
        });
      } else {
        repoIssues.get(repoFullName).commits += commits.length;
        repoIssues.get(repoFullName).issues += userIssues.length;
      }
    } else {
      console.log("No issues found");
    }
  }
  return { uniqueRepoCount: uniqueRepoCount.size, repoIssues };
}

async function getData(github, username) {
  const userRepos = await getUserRepos(github, username);
  const { originalRepos, forkedRepos } = await getUserRepoDetails(
    github,
    userRepos,
    username
  );
  const { uniqueRepoCount, repoIssues } = await getRecentEvents(
    github,
    username
  );

  return {
    originalRepos,
    forkedRepos,
    uniqueRepoCount,
    repoIssues,
  };
}

function formatRepoStats(repo) {
  return `
📂 **${repo.name}**
🌟 Stars: ${repo.stars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}
🔄 Forked: ${
    repo.isForked
      ? "Yes"
      : "No".toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  }

  PR Stats:
  📅 Commits: ${repo.commits.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}
  📅 Issues: ${repo.issues.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}
  💬 Comments: ${repo.comments.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}
  🔄 Pull Requests: ${repo.pullRequests
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",")} 
`;
}

async function getPRAuthorStats(github, context) {
  const author = context.payload.pull_request.user.login;

  try {
    const userData = await github.rest.users.getByUsername({
      username: author,
    });
    const data = await getData(github, author);
    console.log(data);
    var comment = JSON.stringify(data, null, 2);
    await github.rest.issues.createComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: context.issue.number,
      body: comment,
    });
  } catch (error) {
    console.error("Error fetching author stats:", error);
    throw error;
  }
}

async function analyzePRAndComment(github, context) {
  try {
    const authorStats = await getPRAuthorStats(github, context);
    console.log("Successfully posted PR stats comment");
  } catch (error) {
    console.error("Error in analyzePRAndComment:", error);
    throw error;
  }
}

module.exports = {
  analyzePRAndComment,
};
