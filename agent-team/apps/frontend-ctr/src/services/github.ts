// Looks for a pull request on a branch. Optional: used only when CTR_GITHUB_REPO and GITHUB_TOKEN are set.
import { config } from "../config.js"

// Returns the URL of the pull request on the branch, or null when none is found or GitHub is not configured.
export async function findPullRequest(branch: string): Promise<string | null> {
  if (!config.githubRepo || !config.githubToken) {
    return null
  }

  try {
    const owner = config.githubRepo.split("/")[0]
    const url = `https://api.github.com/repos/${config.githubRepo}/pulls?state=all&head=${owner}:${encodeURIComponent(branch)}`

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${config.githubToken}`, Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      return null
    }

    const pulls: any[] = await res.json()

    return pulls[0]?.html_url ?? null
  } catch {
    // A GitHub failure must not break the run; the caller treats it as "no pull request".
    return null
  }
}
