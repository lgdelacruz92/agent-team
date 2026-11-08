// Checks every registered agent in one Resource Manager pass.
import type { OpencodeAgentClientInterface } from "../interfaces/opencode-agent-client.interface.js"
import type { ResourceManagerDatabaseInterface } from "../interfaces/resource-manager-database.interface.js"
import type { ResourceManagerInterface } from "../interfaces/resource-manager.interface.js"

// Only the agent operations are needed for this first slice of reconciliation.
type AgentDatabase = Pick<ResourceManagerDatabaseInterface, "listAgents" | "updateAgentStatus">
type AgentClientFactory = (url: string) => Pick<OpencodeAgentClientInterface, "state">

// Polls agents without starting work or deciding assignment outcomes.
export class ResourceManager implements ResourceManagerInterface {
  constructor(
    private readonly database: AgentDatabase,
    private readonly createClient: AgentClientFactory,
  ) {}

  async runOnce(): Promise<void> {
    const agents = await this.database.listAgents()
    const errors: unknown[] = []

    for (const agent of agents) {
      try {
        if (!agent.url) {
          console.warn(`Agent ${agent.id} has no URL; its state is unknown`)
          continue
        }

        const state = await this.createClient(agent.url).state()
        console.log(`Agent ${agent.id}: ${state}`)

        if (state === "unreachable" && agent.status !== "needs_review") {
          await this.database.updateAgentStatus(agent.id, "needs_review")
        } else if (state === "unknown") {
          // An unusable response is not proof that the server is unreachable.
          console.warn(`Agent ${agent.id} state is unknown; its status was not changed`)
        }
      } catch (error) {
        // Keep checking other agents even when one client or database update fails.
        console.error(`Could not check agent ${agent.id}:`, error)
        errors.push(error)
      }
    }

    if (errors.length > 0) {
      throw new AggregateError(errors, "One or more agent checks failed")
    }
  }
}
