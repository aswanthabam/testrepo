async function getUserRepos(github, username) {
  const userRepos = await github.rest.repos.listForUser({
    username,
    type: "all",
    per_page: 100,
  });

  const repoDetails = await Promise.all(
    userRepos.data.map(async (repo) => {
      // const commits = await github.rest.repos.getCommitActivityStats({
      //   owner: repo.owner.login,
      //   repo: repo.name,
      // });

      return {
        name: repo.name,
        stars: repo.stargazers_count,
        forks: repo.forks_count,
        isForked: repo.fork,
      };
    })
  );

  return repoDetails;
}

async function getContributedRepos(github, username) {
  const events = await github.rest.activity.listPublicEventsForUser({
    username,
    per_page: 100,
  });
  console.log(events);

  const contributedRepos = new Map();

  for (const event of events.data) {
    if (["PushEvent", "PullRequestEvent", "IssuesEvent"].includes(event.type)) {
      const repoFullName = event.repo.name;

      if (!contributedRepos.has(repoFullName)) {
        const [owner, repo] = repoFullName.split("/");
        const repoDetails = await github.rest.repos.get({
          owner,
          repo,
        });

        contributedRepos.set(repoFullName, {
          name: repoFullName,
          stars: repoDetails.data.stargazers_count,
          contributionType: new Set([event.type]),
        });
      } else {
        contributedRepos.get(repoFullName).contributionType.add(event.type);
      }
    }
  }

  return Array.from(contributedRepos.values()).map((repo) => ({
    ...repo,
    contributionType: Array.from(repo.contributionType),
  }));
}

async function getPRAuthorStats(github, context) {
  const author = context.payload.pull_request.user.login;

  try {
    const userData = await github.rest.users.getByUsername({
      username: author,
    });

    const [userRepos, userStatus /*forkedRepoStats, issueStats*/] =
      await Promise.all([
        calculateUserActivity(github, author),
        getUserRepos(github, author),
      ]);
    const [originalRepos, forkedRepos] = [
      userRepos.repoStats.filter((repo) => !repo.isForked),
      userRepos.repoStats.filter((repo) => repo.isForked),
    ];
    return {
      author,
      profile: {
        followers: userData.data.followers,
        following: userData.data.following,
        createdAt: userData.data.created_at,
        publicRepos: userData.data.public_repos,
      },
      originalRepositories: originalRepos,
      forkedRepositories: forkedRepos,
    };
  } catch (error) {
    console.error("Error fetching author stats:", error);
    throw error;
  }
}

async function calculateUserActivity(
  github,
  username,
  since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
) {
  const repoStats = [];
  let totalCommits = 0;
  let totalIssues = 0;
  let totalComments = 0;
  let totalPullRequests = 0;

  try {
    // Get all repositories where the user has been active
    const { data: events } = await github.rest.activity.listPublicEventsForUser(
      {
        username,
        per_page: 100,
      }
    );

    // Group events by repository
    const repoEvents = new Map();

    for (const event of events) {
      const repoFullName = event.repo.name;
      if (!repoEvents.has(repoFullName)) {
        repoEvents.set(repoFullName, new Set([event.type]));
      } else {
        repoEvents.get(repoFullName)?.add(event.type);
      }
    }

    // Process each repository
    for (const [repoFullName, eventTypes] of repoEvents) {
      const [owner, repo] = repoFullName.split("/");
      if (!owner || !repo) continue;

      try {
        // Get repository details
        const { data: repoData } = await github.rest.repos.get({
          owner,
          repo,
        });
        console.log(repoData);

        // Get commits by user
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
            creator: username,
            since,
            state: "all",
            per_page: 100,
          })
          .catch(() => ({ data: [] }));

        // Get comments by user
        const { data: comments } = await github.rest.issues
          .listCommentsForRepo({
            owner,
            repo,
            since,
            per_page: 100,
          })
          .catch(() => ({ data: [] }));

        // Filter comments by the user
        const userComments = comments.filter(
          (comment) => comment.user?.login === username
        );

        // Get pull requests by user
        const { data: pullRequests } = await github.rest.pulls
          .list({
            owner,
            repo,
            state: "all",
            per_page: 100,
          })
          .catch(() => ({ data: [] }));

        const userPullRequests = pullRequests.filter(
          (pr) => pr.user?.login === username
        );

        // Calculate statistics for this repository
        const repoActivity = {
          repoName: repoFullName,
          isForked: repoData.fork,
          commits: commits.length,
          issues: issues.length,
          comments: userComments.length,
          pullRequests: userPullRequests.length,
          stars: repoData.stargazers_count,
          contributedAt:
            events.find((e) => e.repo.name === repoFullName)?.created_at ||
            new Date().toISOString(),
        };

        totalCommits += repoActivity.commits;
        totalIssues += repoActivity.issues;
        totalComments += repoActivity.comments;
        totalPullRequests += repoActivity.pullRequests;

        repoStats.push(repoActivity);
      } catch (error) {
        console.warn(`Error fetching data for ${repoFullName}:`, error);
        continue;
      }
    }

    repoStats.sort(
      (a, b) =>
        new Date(b.contributedAt).getTime() -
        new Date(a.contributedAt).getTime()
    );

    return {
      totalCommits,
      totalIssues,
      totalComments,
      totalPullRequests,
      repoStats,
    };
  } catch (error) {
    console.error("Error calculating user activity:", error);
    throw error;
  }
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

function formatStatsComment(stats) {
  return (
    `
📊 **Stats for ${stats.author}** 📊

📦 **Original Repositories**
` +
    stats.originalRepositories.map((repo) => formatRepoStats(repo)).join("\n") +
    `
🍴 **Forked Repositories**
` +
    stats.forkedRepositories.map((repo) => formatRepoStats(repo)).join("\n")
  );
}

async function calculateScore(github, context) {
  const userRepositories = await getUserRepos(
    github,
    context.payload.pull_request.user.login
  );
  const contributedRepos = await getContributedRepos(
    github,
    context.payload.pull_request.user.login
  );

  const forkedRepoStats = userRepositories.filter((repo) => repo.isForked);
  const repoStats = userRepositories.filter((repo) => !repo.isForked);

  var starCount = repoStats.reduce((acc, repo) => acc + repo.stars, 0);
  var originalRepoCount = repoStats.length;

  var score = originalRepoCount * Math.sqrt(starCount);
}

async function analyzePRAndComment(github, context) {
  try {
    const authorStats = await getPRAuthorStats(github, context);
    const comment = formatStatsComment(authorStats);

    await github.rest.issues.createComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: context.issue.number,
      body: comment,
    });

    console.log("Successfully posted PR stats comment");
  } catch (error) {
    console.error("Error in analyzePRAndComment:", error);
    throw error;
  }
}

module.exports = {
  analyzePRAndComment,
};
