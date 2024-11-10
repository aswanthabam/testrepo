// analyzeAuthor.js
async function getUserRepos(github, username) {
  const userRepos = await github.rest.repos.listForUser({
    username,
    type: "all",
    per_page: 100,
  });

  const repoDetails = await Promise.all(
    userRepos.data.map(async (repo) => {
      // Get commit count for the repo
      const commits = await github.rest.repos.getCommitActivityStats({
        owner: repo.owner.login,
        repo: repo.name,
      });

      return {
        name: repo.name,
        stars: repo.stargazers_count,
        forks: repo.forks_count,
        isForked: repo.fork,
        commitActivity: commits.data
          ? commits.data.reduce((sum, week) => sum + week.total, 0)
          : 0,
        language: repo.language,
        description: repo.description,
        createdAt: repo.created_at,
      };
    })
  );

  return repoDetails;
}

// async function getForkedRepoStats(github, username) {
//   const userRepos = await github.rest.repos.listForUser({
//     username,
//     type: "forks",
//     per_page: 100,
//   });

//   const forkedRepoStats = await Promise.all(
//     userRepos.data.map(async (repo) => {
//       // Get parent repository details
//       const parentRepo = await github.rest.repos.get({
//         owner: repo.source?.owner?.login || repo.parent?.owner?.login,
//         repo: repo.source?.name || repo.parent?.name,
//       });

//       // Get PRs made by user to parent repo
//       const prs = await github.rest.pulls.list({
//         owner: parentRepo.data.owner.login,
//         repo: parentRepo.data.name,
//         state: "all",
//         creator: username,
//       });

//       return {
//         forkedRepo: repo.name,
//         parentRepo: parentRepo.data.full_name,
//         parentStars: parentRepo.data.stargazers_count,
//         prCount: prs.data.length,
//         prDetails: prs.data.map((pr) => ({
//           title: pr.title,
//           state: pr.state,
//           createdAt: pr.created_at,
//         })),
//       };
//     })
//   );

//   return forkedRepoStats;
// }

// async function getUserIssues(github, username) {
//   const issues = await github.rest.search.issuesAndPullRequests({
//     q: `author:${username} type:issue`,
//     per_page: 100,
//   });

//   const issueStats = await Promise.all(
//     issues.data.items.map(async (issue) => {
//       const repoDetails = await github.rest.repos.get({
//         owner: issue.repository_url.split("/").slice(-2, -1)[0],
//         repo: issue.repository_url.split("/").slice(-1)[0],
//       });

//       return {
//         title: issue.title,
//         repo: issue.repository_url.split("/").slice(-2).join("/"),
//         state: issue.state,
//         createdAt: issue.created_at,
//         repoStars: repoDetails.data.stargazers_count,
//       };
//     })
//   );

//   return issueStats;
// }

// async function getContributedRepos(github, username) {
//   const events = await github.rest.activity.listPublicEventsForUser({
//     username,
//     per_page: 100,
//   });

//   const contributedRepos = new Map();

//   for (const event of events.data) {
//     if (["PushEvent", "PullRequestEvent", "IssuesEvent"].includes(event.type)) {
//       const repoFullName = event.repo.name;

//       if (!contributedRepos.has(repoFullName)) {
//         const [owner, repo] = repoFullName.split("/");
//         const repoDetails = await github.rest.repos.get({
//           owner,
//           repo,
//         });

//         contributedRepos.set(repoFullName, {
//           name: repoFullName,
//           stars: repoDetails.data.stargazers_count,
//           contributionType: new Set([event.type]),
//         });
//       } else {
//         contributedRepos.get(repoFullName).contributionType.add(event.type);
//       }
//     }
//   }

//   return Array.from(contributedRepos.values()).map((repo) => ({
//     ...repo,
//     contributionType: Array.from(repo.contributionType),
//   }));
// }

async function getPRAuthorStats(github, context) {
  const author = context.payload.pull_request.user.login;

  try {
    // Get user profile data
    const userData = await github.rest.users.getByUsername({
      username: author,
    });

    // Get all detailed statistics
    const [userRepos /*forkedRepoStats, issueStats, contributedRepos*/] =
      await Promise.all([
        getUserRepos(github, author),
        // getForkedRepoStats(github, author),
        // getUserIssues(github, author),
        // getContributedRepos(github, author),
      ]);

    return {
      author,
      profile: {
        followers: userData.data.followers,
        following: userData.data.following,
        createdAt: userData.data.created_at,
        publicRepos: userData.data.public_repos,
      },
      repositories: userRepos,
      // forkedRepos: forkedRepoStats,
      // issues: issueStats,
      // contributions: contributedRepos,
    };
  } catch (error) {
    console.error("Error fetching author stats:", error);
    throw error;
  }
}

function formatStatsComment(stats) {
  return (
    `
📊 **Stats for ${stats.author}** 📊

👥 **Profile**
- Followers: ${stats.profile.followers}
- Following: ${stats.profile.following}
- Created at: ${stats.profile.createdAt}
- Public Repos: ${stats.profile.publicRepos}

📦 **Repositories**
` +
    stats.repositories
      .map((repo) => {
        return `
- **${repo.name}**
  - Stars: ${repo.stars}
  - Forks: ${repo.forks}
  - Is Forked: ${repo.isForked}
  - Commit Activity: ${repo.commitActivity}
  `;
      })
      .join("")
  );
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
