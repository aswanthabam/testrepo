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
                var count = 0;
                for (var data of res.data) {
                  if (
                    data?.node_id &&
                    data?.node_id.startsWith("I_") &&
                    data?.user &&
                    data?.user?.login === username
                  ) {
                    count++;
                  }
                }
                return count;
                // console.log("IssueResponse:", res);
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

async function getStatsMessage(data, username) {
  const { originalRepos, forkedRepos, uniqueRepoCount, repoIssues } = data;
  const originalRepoCount = originalRepos.length;
  const originalRepoStars = originalRepos
    .filter((repo) => repo.name.split("/")[0] == username)
    .reduce((acc, repo) => {
      print(acc, repo.stars);
      return acc + parseInt(repo.stars);
    });
  console.log("OSTARS", originalRepoStars);
  const forkedRepoCount = forkedRepos.length;
  const forkedRepoStars = forkedRepos.reduce((acc, repo) => acc + repo.stars);
  const pullRequestCount = forkedRepos.reduce(
    (acc, repo) => acc + repo.pullRequests,
    0
  );
  const pullRequestRepoStars = forkedRepos
    .filter((repo) => repo.pullRequests > 0)
    .reduce((acc, repo) => acc + repo.stars, 0);
  const userRepos = [];
  for (var repo of originalRepos) {
    userRepos.push(repo.name);
  }
  for (var repo of forkedRepos) {
    userRepos.push(repo.name);
  }
  console.log("Repo Issues:", repoIssues);
  var issueNonForkCount = 0;
  var issueCount = 0;
  var commitCount = 0;
  for (var [repo, value] of repoIssues) {
    console.log(value);
    // var [owner, repoName] = repo.split("/");
    var { commits, issues } = value;
    if (!userRepos.includes(repo)) {
      issueNonForkCount += issues;
    } else {
      issueCount += issues;
    }
    if (userRepos.includes(repo)) {
      commitCount += commits;
    }
  }
  var eventScore = commitCount + issueCount;
  console.log(originalRepoCount, originalRepoStars);
  console.log(pullRequestCount, pullRequestRepoStars);
  var contributionScore =
    originalRepoCount * Math.sqrt(originalRepoStars) +
    pullRequestCount * 3 * Math.log10(pullRequestRepoStars + 1);
  var issueScore = issueNonForkCount * 2;
  var recentContribScore = uniqueRepoCount * 3;

  var totalScore =
    eventScore + contributionScore + issueScore + recentContribScore;
  const message = `
  # Stats for ${originalRepos[0].owner}
  
  **Total Repositories Created**: ${originalRepoCount}
  **Total Forked Repositories**: ${forkedRepoCount}
  **Total Pull Requests Created**: ${pullRequestCount}
  **Total Unique Repositories Contributed To**: ${uniqueRepoCount}
  **Total Issues Created in Non Forked Repositories**: ${issueNonForkCount}
  **Total Issues Created in Forked Repositories**: ${issueCount}
  **Total Commits**: ${commitCount}

  ## Scoring

  **Event Score**: ${eventScore}
  **Contribution Score**: ${contributionScore}
  **Issue Score**: ${issueScore}
  **Recent Contribution Score**: ${recentContribScore}

  **Total Score**: ${totalScore}

  ## Next Steps

  ${
    totalScore > 300
      ? "🚀 **Congratulations!**\nYour opensource contributions are great!\nYou can participate in Top100Coders"
      : "**Start working now**\nComplete tasks on mulearn discord server and collect karma points to participate in Top100Coders"
  }
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
    body = await getStatsMessage(data, author);
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
