import { assign, createMachine } from "xstate"

/** States for issued policy lifecycle. */
export type PolicyLifecycleStatus = "issuing" | "active" | "inactive"

/** Context used to decide lifecycle transitions. */
export interface PolicyLifecycleContext {
  readonly endDate?: string
  readonly status: PolicyLifecycleStatus
}

/** Events that move a policy through its lifecycle. */
export type PolicyLifecycleEvent =
  | { type: "ISSUE" }
  | { type: "EXPIRE" }

/** True when a string is present and non-empty. */
const hasValue = (value?: string) => Boolean(value && value.trim().length > 0)

/** Normalizes various date inputs to YYYY-MM-DD. */
const toDateOnly = (value?: string) => {
  if (!value) return ""
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }
  return parsed.toISOString().slice(0, 10)
}

/** True when coverage has ended based on UTC date. */
const coverageEnded = (endDate?: string) => {
  if (!hasValue(endDate)) return false
  const today = new Date().toISOString().slice(0, 10)
  return toDateOnly(endDate) <= today
}

/** Lifecycle machine for issued policies. */
export const policyLifecycleMachine = createMachine({
  types: {} as {
    context: PolicyLifecycleContext
    events: PolicyLifecycleEvent
  },
  id: "policyLifecycle",
  initial: "issuing",
  context: {
    status: "issuing" as PolicyLifecycleStatus
  },
  states: {
    issuing: {
      on: {
        ISSUE: [
          {
            target: "inactive",
            guard: ({ context }) => coverageEnded(context.endDate),
            actions: assign({ status: () => "inactive" })
          },
          {
            target: "active",
            actions: assign({ status: () => "active" })
          }
        ]
      }
    },
    active: {
      on: {
        EXPIRE: {
          target: "inactive",
          guard: ({ context }) => coverageEnded(context.endDate),
          actions: assign({ status: () => "inactive" })
        }
      }
    },
    inactive: {
      type: "final"
    }
  }
})
