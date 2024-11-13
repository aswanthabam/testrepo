const fetch = require("node-fetch");

SECRET = process.env.SECRET;

async function postComment(owner, repo, issue_number, body) {
  const url = `https://api.github.com/repos/${owner}/${repo}/issues/${issue_number}/comments`;
  console.log("Posting comment to:", url);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `token ${SECRET}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      body: body,
    }),
  });

  if (response.ok) {
    const data = await response.json();
    console.log("Comment posted successfully!");
    console.log("Comment URL:", data.html_url);
  } else {
    console.error(
      "Failed to post comment",
      response.status,
      await response.json(),
      SECRET
    );
  }
}

async function getUserRepos(github, username) {
  const { data: userRepos } = await github.rest.repos.listForUser({
    username,
    type: "all",
    per_page: 100, // GitHub limits per_page to 100
  });

  var data = await Promise.all(
    userRepos.map(async (repo) => {
      if (repo.fork) {
        const repoData = await github.rest.repos.get({
          owner: repo.owner.login,
          repo: repo.name,
        });
        return {
          ...repo,
          parent: repoData.data?.parent,
        };
      } else {
        return repo;
      }
    })
  );

  return data.map((repo) => ({
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
  const forkedReposWithPRCounts = await Promise.all(
    forkedRepos.map(async (repo) => {
      if (repo.parent) {
        const [owner, repoName] = repo.parent.full_name.split("/");

        const { data: pullRequests } = await github.rest.pulls.list({
          owner,
          repo: repoName,
          state: "all",
          per_page: 100,
        });

        var data = {
          ...repo,
          pullRequests: pullRequests.filter((pr) => pr.user?.login === username)
            .length,
        };
        return data;
      } else {
        return repo;
      }
    })
  );

  return forkedReposWithPRCounts;
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
        console.log(event.repo.name);
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
                console.log("IssueResponse:", res);
                if (res.data?.node_id && res.data?.node_id.startsWith("I_")) {
                  return res.data.filter(
                    (issue) => issue.user?.login === username
                  ).length;
                } else {
                  return 0;
                }
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
  var forkedRepos = userRepos.filter((repo) => repo.isForked);

  forkedRepos = await getPullRequestCounts(github, forkedRepos, username);
  forkedRepos = forkedRepos.map((repo) => {
    return {
      ...repo,
      parent: null,
    };
  });
  const { uniqueRepoCount, repoIssues } = await getRecentEvents(
    github,
    username
  );

  return { originalRepos, forkedRepos, uniqueRepoCount, repoIssues };
}

// function formatRepoStats(repo) {
//   return `
// 📂 **${repo.name}**
// 🌟 Stars: ${repo.stars.toLocaleString()}
// 🔄 Forked: ${repo.isForked ? "Yes" : "No"}

// PR Stats:
// 📅 Commits: ${repo.commits?.toLocaleString() || 0}
// 📅 Issues: ${repo.issues?.toLocaleString() || 0}
// 🔄 Pull Requests: ${repo.pullRequests?.toLocaleString() || 0}
// `;
// }

async function getStatsMessage(data) {
  const { originalRepos, forkedRepos, uniqueRepoCount, repoIssues } = data;
  const originalRepoCount = originalRepos.length;
  const forkedRepoCount = forkedRepos.length;
  const pullRequestCount = forkedRepos.reduce(
    (acc, repo) => acc + repo.pullRequests,
    0
  );
  console.log("Repo Issues:", repoIssues);
  const issueCount = Array.from(repoIssues.values()).reduce(
    (sum, repo) => sum + repo.issues,
    0
  );

  const message = `
  **Total Repositories Created**: ${originalRepoCount}
  **Total Forked Repositories**: ${forkedRepoCount}
  **Total Pull Requests Created**: ${pullRequestCount}
  **Total Issues Created**: ${issueCount}
  `;
  return message;
}

async function getPRAuthorStats(github, context) {
  const author = context.payload.pull_request.user.login;

  try {
    const data = await getData(github, author);
    // console.log("Data:", data);
    // const { Octokit } = await import("@octokit/rest");
    // const octokit = new Octokit({
    //   auth: process.env.GITHUB_TOKEN, // Ensure you have GITHUB_TOKEN in your GitHub Actions secrets
    // });
    owner = context.repo.owner;
    repo = context.repo.repo;
    issue_number = context.issue.number;
    body = JSON.stringify(data, null, 4);
    // console.log(data);
    body = await getStatsMessage(data);
    // console.log("Posting comment with data:", body);
    // await postComment(owner, repo, issue_number, body);
    await github.rest.issues.createComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: context.issue.number,
      body: body,
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
