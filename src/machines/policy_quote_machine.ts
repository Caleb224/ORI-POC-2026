import { assign, createMachine } from "xstate"

/** Allowed states for the quote workflow. */
export type QuoteStatus = "quoted" | "approved" | "declined"

/** Data required to evaluate quote transitions. */
export interface QuoteContext {
  readonly premiumCents?: number
  readonly effectiveDate?: string
  readonly endDate?: string
  readonly policyNumber?: string
  readonly holderName?: string
  readonly status: QuoteStatus
}

/** Events that move a quote through underwriting. */
export type QuoteEvent =
  | { type: "APPROVED"; effectiveDate: string }
  | { type: "DECLINED" }

/** True when a string is present and non-empty. */
const hasValue = (value?: string) => Boolean(value && value.trim().length > 0)

/** Ensures required fields exist before approval. */
const isQuoteComplete = (context: QuoteContext) =>
  hasValue(context.policyNumber) &&
  hasValue(context.holderName) &&
  typeof context.premiumCents === "number" &&
  context.premiumCents > 0 &&
  hasValue(context.effectiveDate) &&
  hasValue(context.endDate)

/** Workflow machine for quote approval or decline. */
export const quoteMachine = createMachine({
  types: {} as {
    context: QuoteContext
    events: QuoteEvent
  },
  id: "policyQuote",
  initial: "quoted",
  context: {
    status: "quoted" as QuoteStatus
  },
  states: {
    quoted: {
      on: {
        APPROVED: {
          target: "approved",
          guard: ({ context, event }) =>
            isQuoteComplete(context) && hasValue(event.effectiveDate),
          actions: assign({
            effectiveDate: ({ event }) => event.effectiveDate,
            status: () => "approved"
          })
        },
        DECLINED: {
          target: "declined",
          actions: assign({ status: () => "declined" })
        }
      }
    },
    approved: {
      type: "final"
    },
    declined: {
      type: "final"
    }
  }
})
