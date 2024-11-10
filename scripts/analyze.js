const { Octokit } = require("@octokit/rest");

async function getUserRepos(github, username) {
  const { data: userRepos } = await github.rest.repos.listForUser({
    username,
    type: "all",
    per_page: 100,
  });

  return Promise.all(
    userRepos.map(async (repo) => {
      try {
        await github.rest.repos.getCommitActivityStats({
          owner: repo.owner?.login ?? username,
          repo: repo.name,
        });
      } catch (error) {
        console.warn(
          `Unable to fetch commit activity for ${repo.name}:`,
          error
        );
      }

      return {
        name: repo.name,
        stars: repo.stargazers_count ?? 0,
        forks: repo.forks_count ?? 0,
        isForked: repo.fork ?? false,
        language: repo.language,
        description: repo.description,
        createdAt: repo.created_at ?? new Date().toISOString(),
      };
    })
  );
}

async function getContributedRepos(github, username) {
  const { data: events } = await github.rest.activity.listPublicEventsForUser({
    username,
    per_page: 100,
  });

  const contributedRepos = new Map();

  for (const event of events) {
    if (
      event.type &&
      ["PushEvent", "PullRequestEvent", "IssuesEvent"].includes(event.type)
    ) {
      const repoFullName = event.repo.name;
      const eventType = event.type;

      if (!contributedRepos.has(repoFullName)) {
        try {
          const [owner, repo] = repoFullName.split("/");
          if (!owner || !repo) continue;

          const { data: repoDetails } = await github.rest.repos.get({
            owner,
            repo,
          });

          contributedRepos.set(repoFullName, {
            name: repoFullName,
            stars: repoDetails.stargazers_count ?? 0,
            contributionType: new Set([eventType]),
          });
        } catch (error) {
          console.warn(
            `Unable to fetch repo details for ${repoFullName}:`,
            error
          );
          continue;
        }
      } else {
        const repo = contributedRepos.get(repoFullName);
        if (repo) {
          repo.contributionType.add(eventType);
        }
      }
    }
  }

  return Array.from(contributedRepos.values()).map((repo) => ({
    ...repo,
    contributionType: Array.from(repo.contributionType),
  }));
}

async function getPRAuthorStats(github, context) {
  const author = context.payload.pull_request?.user?.login;
  if (!author) {
    throw new Error("Pull request author not found in context");
  }

  try {
    const { data: userData } = await github.rest.users.getByUsername({
      username: author,
    });

    const [userRepos, contributedRepos] = await Promise.all([
      getUserRepos(github, author),
      getContributedRepos(github, author),
    ]);

    return {
      author,
      profile: {
        followers: userData.followers ?? 0,
        following: userData.following ?? 0,
        createdAt: userData.created_at ?? new Date().toISOString(),
        publicRepos: userData.public_repos ?? 0,
      },
      repositories: userRepos,
      contributions: contributedRepos,
    };
  } catch (error) {
    console.error("Error fetching author stats:", error);
    throw error;
  }
}

function formatStatsComment(stats) {
  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  return `
📊 **Stats for ${stats.author}** 📊

👥 **Profile**
- Followers: ${stats.profile.followers}
- Following: ${stats.profile.following}
- Created at: ${formatDate(stats.profile.createdAt)}
- Public Repos: ${stats.profile.publicRepos}

📦 **Repositories** (${stats.repositories.length})
${stats.repositories
  .sort((a, b) => b.stars - a.stars)
  .slice(0, 10)
  .map(
    (repo) => `
- **${repo.name}**
  - Stars: ${repo.stars}
  - Forks: ${repo.forks}
  - Language: ${repo.language ?? "N/A"}
  - Created: ${formatDate(repo.createdAt)}
  ${repo.description ? `  - Description: ${repo.description}` : ""}`
  )
  .join("")}

🔗 **Recent Contributions** (${stats.contributions.length})
${stats.contributions
  .sort((a, b) => b.stars - a.stars)
  .slice(0, 10)
  .map(
    (repo) => `
- **${repo.name}**
  - Stars: ${repo.stars}
  - Activities: ${repo.contributionType.join(", ")}`
  )
  .join("")}`;
}

async function analyzePRAndComment(github, context) {
  if (!context.payload.pull_request) {
    throw new Error("This action can only be run on pull requests");
  }

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
  getPRAuthorStats,
  formatStatsComment,
};
