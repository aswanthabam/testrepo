async function getUserRepos(github, username) {
  const userRepos = await github.rest.repos.listForUser({
    username,
    type: "all",
    per_page: 100,
  });

  const repoDetails = await Promise.all(
    userRepos.data.map(async (repo) => {
      const commits = await github.rest.repos.getCommitActivityStats({
        owner: repo.owner.login,
        repo: repo.name,
      });

      return {
        name: repo.name,
        stars: repo.stargazers_count,
        forks: repo.forks_count,
        isForked: repo.fork,

        language: repo.language,
        description: repo.description,
        createdAt: repo.created_at,
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

    const [userRepos /*forkedRepoStats, issueStats*/, contributedRepos] =
      await Promise.all([
        getUserRepos(github, author),

        getContributedRepos(github, author),
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

      contributions: contributedRepos,
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
  `;
      })
      .join("") +
    (`
🔗 **Contributions**
` +
      stats.contributions.map((repo) => {
        return `
- **${repo.name}**
  - Stars: ${repo.stars}
  - Contribution Type: ${repo.contributionType.join(", ")}
  `;
      }))
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
