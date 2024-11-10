async function getUserRepos(github, username) {
  const { data: userRepos } = await github.rest.repos.listForUser({
    username,
    type: "all",
    per_page: 100, // GitHub limits per_page to 100
  });

  userRepos.map(async (repo) => {
    if (repo.fork) {
      var repoData = await github.rest.repos.get({
        owner: repo.owner.login,
        repo: repo.name,
      });
      return {
        ...repo,
        parent: repoData.data?.parent,
      };
    } else {
      // Not a fork, no parent repository
      return repo;
    }
  });

  return userRepos.map((repo) => ({
    name: repo.full_name,
    owner: repo.owner.login,
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    isForked: repo.fork,
    pullRequests: 0,
    parent: repo.parent,
  }));
}

async function getPullRequestCounts(github, forkedRepos, username) {
  const promises = forkedRepos.map(async (repo) => {
    if (repo.parent) {
      const [owner, repoName] = repo.parent.full_name.split("/");
      const { data: pullRequests } = await github.rest.pulls.list({
        owner,
        repo: repoName,
        state: "all",
        per_page: 100,
      });

      repo.pullRequests = pullRequests.filter(
        (pr) => pr.user?.login === username
      ).length;
    } else {
      console.log("No parent found for forked repo", repo.name);
    }
  });

  await Promise.all(promises);
}

async function getRecentEvents(github, username, since = null) {
  since =
    since || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const uniqueRepos = new Set();
  const repoIssues = new Map();
  let page = 1;
  let hasMore = true;
  let totalEvents = 0;

  while (hasMore && totalEvents < 300) {
    const { data: events } = await github.rest.activity.listPublicEventsForUser(
      {
        username,
        per_page: 100,
        page,
      }
    );

    for (const event of events) {
      const [owner, repoName] = event.repo.name.split("/");
      if (!uniqueRepos.has(event.repo.name)) {
        uniqueRepos.add(event.repo.name);
        if (event.repo.name != "anjalikdas/django-signals") {
          continue;
        }
        // Fetch commits and issues only once per repository
        const [commits, issues] = await Promise.all([
          github.rest.repos
            .listCommits({
              owner,
              repo: repoName,
              author: username,
              since,
              per_page: 100,
            })
            .then((res) => res.data.length)
            .catch(() => 0),

          github.rest.issues
            .listForRepo({
              owner,
              repo: repoName,
              since,
              state: "all",
              per_page: 100,
            })
            .then((res) => {
              {
                console.log("ISSUE", res.data);
                return res.data.filter(
                  (issue) => issue.user?.login === username
                ).length;
              }
            })
            .catch(() => 0),
        ]);

        repoIssues.set(event.repo.name, { commits, issues });
      }
    }

    page++;
    totalEvents += events.length;
    hasMore = events.length === 100;
  }

  return { uniqueRepoCount: uniqueRepos.size, repoIssues };
}

async function getData(github, username) {
  const userRepos = await getUserRepos(github, username);
  const originalRepos = userRepos.filter((repo) => !repo.isForked);
  const forkedRepos = userRepos.filter((repo) => repo.isForked);

  await getPullRequestCounts(github, forkedRepos, username);
  const { uniqueRepoCount, repoIssues } = await getRecentEvents(
    github,
    username
  );

  return { originalRepos, forkedRepos, uniqueRepoCount, repoIssues };
}

function formatRepoStats(repo) {
  return `
📂 **${repo.name}**
🌟 Stars: ${repo.stars.toLocaleString()}
🔄 Forked: ${repo.isForked ? "Yes" : "No"}

PR Stats:
📅 Commits: ${repo.commits?.toLocaleString() || 0}
📅 Issues: ${repo.issues?.toLocaleString() || 0}
🔄 Pull Requests: ${repo.pullRequests?.toLocaleString() || 0}
`;
}

async function getPRAuthorStats(github, context) {
  const author = context.payload.pull_request.user.login;

  try {
    const data = await getData(github, author);
    console.log(data);

    await github.rest.issues.createComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: context.issue.number,
      body: JSON.stringify(data, null, 4),
    });
  } catch (error) {
    console.error("Error fetching author stats:", error);
    throw error;
  }
}

async function analyzePRAndComment(github, context) {
  try {
    await getPRAuthorStats(github, context);
    console.log("Successfully posted PR stats comment");
  } catch (error) {
    console.error("Error in analyzePRAndComment:", error);
    throw error;
  }
}

module.exports = {
  analyzePRAndComment,
};
