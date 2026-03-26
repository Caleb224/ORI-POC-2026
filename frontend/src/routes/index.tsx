import { createFileRoute } from "@tanstack/react-router"
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react"
import { toast } from "sonner"
import { Badge } from "#/components/ui/badge"
import { Button } from "#/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#/components/ui/card"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "#/components/ui/tooltip"

export const Route = createFileRoute("/")({ component: App })

type Policy = {
  id: string
  policyNumber: string
  holderName: string
  status: "quoted" | "approved" | "active" | "inactive" | "declined"
  premiumCents: number
  effectiveDate: string
  endDate: string
  createdAt: string
}

const DEFAULT_API_BASE = "http://127.0.0.1:4000"
const RAW_API_BASE = (import.meta.env?.VITE_API_BASE_URL ?? "")
  .trim()
  .replace(/\/$/, "")

const normalizeApiBase = (raw: string) => {
  if (!raw) {
    return DEFAULT_API_BASE
  }
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`
  try {
    return new URL(withScheme).origin
  } catch {
    return DEFAULT_API_BASE
  }
}

const API_BASE = normalizeApiBase(RAW_API_BASE)

const resolveApiUrl = (path: string) => new URL(path, API_BASE).toString()

function App() {
  const [policies, setPolicies] = useState<Policy[]>([])
  const [loading, setLoading] = useState(false)
  const [_error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    policyNumber: "",
    holderName: "",
    premiumCents: "",
    effectiveDate: "",
    endDate: "",
  })

  const premiumDollars = useMemo(() => {
    const value = Number(form.premiumCents)
    return Number.isFinite(value) ? (value / 100).toFixed(2) : "0.00"
  }, [form.premiumCents])

  const loadPolicies = useCallback(async (options?: { notify?: boolean }) => {
    setLoading(true)
    setError(null)
    try {
      const listUrl = resolveApiUrl("/policies")
      const res = await fetch(listUrl, {
        cache: "no-store",
        headers: { Accept: "application/json" },
      })
      const text = await res.text()
      const contentType = res.headers.get("content-type") ?? "unknown"
      const handler = res.headers.get("x-handler") ?? "unknown"
      const length = res.headers.get("content-length") ?? "unknown"
      if (!res.ok) {
        throw new Error("Failed to load policies")
      }
      if (!text) {
        throw new Error(
          `Empty response from API (status ${res.status}, content-type ${contentType}, content-length ${length}, handler ${handler})`
        )
      }
      let data: unknown
      try {
        data = JSON.parse(text) as unknown
      } catch {
        throw new Error(`Unexpected response from API: ${text}`)
      }
      const normalized = Array.isArray(data)
        ? data
        : data && typeof data === "object"
        ? Array.isArray((data as { policies?: unknown }).policies)
          ? (data as { policies: unknown[] }).policies
          : Object.values(data as Record<string, unknown>)
        : null
      if (!normalized) {
        throw new Error("Unexpected response from API")
      }
      setPolicies(normalized as Policy[])
      if (options?.notify) {
        toast.success("Policies refreshed")
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown error"
      setError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadPolicies()
  }, [loadPolicies])

  const handleQuote = async (event: FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(resolveApiUrl("/policies/quote"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          policyNumber: form.policyNumber,
          holderName: form.holderName,
          premiumCents: Number(form.premiumCents),
          effectiveDate: form.effectiveDate,
          endDate: form.endDate,
        }),
      })
      if (!res.ok) {
        throw new Error("Failed to create quote")
      }
      setForm({
        policyNumber: "",
        holderName: "",
        premiumCents: "",
        effectiveDate: "",
        endDate: "",
      })
      await loadPolicies({ notify: true })
      toast.success("Quote created")
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown error"
      setError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  const transitionPolicy = async (
    id: string,
    action: "approve" | "activate" | "deactivate" | "decline",
    effectiveDate?: string
  ) => {
    setLoading(true)
    setError(null)
    try {
      const payload =
        action === "approve" ? { effectiveDate } : undefined
      const res = await fetch(
        resolveApiUrl(`/policies/${id}/${action}`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload ? JSON.stringify(payload) : undefined,
        }
      )
      if (!res.ok) {
        throw new Error(`Failed to ${action} policy`)
      }
      await loadPolicies({ notify: true })
      toast.success(`Policy ${action}d`)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown error"
      setError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  const statusBadge = (status: Policy["status"]) => {
    const variant =
      status === "active"
        ? "default"
        : status === "approved"
        ? "secondary"
        : status === "inactive"
        ? "outline"
        : status === "declined"
        ? "destructive"
        : "outline"
    return <Badge variant={variant}>{status}</Badge>
  }

  const toDateOnly = (value: string) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return value
    }
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) {
      return value
    }
    return parsed.toISOString().slice(0, 10)
  }

  const coverageEnded = (endDate: string) => {
    if (!endDate) return false
    const today = new Date().toISOString().slice(0, 10)
    return toDateOnly(endDate) <= today
  }

  const nextTransitions = (policy: Policy) => {
    switch (policy.status) {
      case "quoted":
        return ["approved", "declined"]
      case "approved":
        return ["active"]
      case "active":
        return coverageEnded(policy.endDate) ? ["inactive"] : []
      default:
        return []
    }
  }

  const statusExplanation = (status: Policy["status"]) => {
    switch (status) {
      case "quoted":
        return "Quote captured and awaiting underwriting decision."
      case "approved":
        return "Approved for issuance but not yet in force."
      case "active":
        return "Issued and in force until the end date."
      case "inactive":
        return "Coverage has ended and the policy is no longer in force."
      case "declined":
        return "Quote declined; no policy was issued."
      default:
        return "Status information unavailable."
    }
  }

  const transitionActionForStatus = (
    status: "approved" | "active" | "inactive" | "declined"
  ) => {
    switch (status) {
      case "approved":
        return "approve"
      case "active":
        return "activate"
      case "inactive":
        return "deactivate"
      case "declined":
        return "decline"
      default:
        return "approve"
    }
  }

  return (
    <main className="page-wrap px-4 pb-10 pt-12">
      <section className="island-shell rise-in relative overflow-hidden rounded-4xl px-6 py-10 sm:px-10 sm:py-12">
        <div className="pointer-events-none absolute -left-20 -top-24 h-56 w-56 rounded-full bg-[radial-gradient(circle,var(--hero-a),transparent_66%)]" />
        <div className="pointer-events-none absolute -bottom-20 -right-20 h-56 w-56 rounded-full bg-[radial-gradient(circle,var(--hero-b),transparent_66%)]" />
        <p className="island-kicker mb-3">Policy Quoting Dashboard</p>
        <h1 className="display-title mb-4 text-4xl leading-tight font-bold text-(--sea-ink) sm:text-5xl">
          Quote, approve, activate, and deactivate policies.
        </h1>
        <p className="max-w-2xl text-sm text-(--sea-ink-soft) sm:text-base">
          This minimal workflow surfaces the policy creation state machine and
          moves policies through quoted → approved → active → inactive, with a
          decline path for exceptions.
        </p>
      </section>

      <section className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_2fr]">
        <Card className="h-full">
          <CardHeader>
            <CardTitle>Create Quote</CardTitle>
            <CardDescription>
              Capture a new policy quote before underwriting.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4" onSubmit={handleQuote}>
              <div className="grid gap-2">
                <Label htmlFor="policyNumber">Policy Number</Label>
                <Input
                  id="policyNumber"
                  value={form.policyNumber}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      policyNumber: event.target.value,
                    }))
                  }
                  placeholder="POL-2025-001"
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="holderName">Policy Holder</Label>
                <Input
                  id="holderName"
                  value={form.holderName}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      holderName: event.target.value,
                    }))
                  }
                  placeholder="Jamie Chen"
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="premiumCents">Premium (cents)</Label>
                <Input
                  id="premiumCents"
                  value={form.premiumCents}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      premiumCents: event.target.value,
                    }))
                  }
                  placeholder="125000"
                  inputMode="numeric"
                  required
                />
                <p className="text-xs text-muted-foreground">
                  ${premiumDollars} per term
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="effectiveDate">Effective Date</Label>
                <Input
                  id="effectiveDate"
                  type="date"
                  value={form.effectiveDate}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      effectiveDate: event.target.value,
                    }))
                  }
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="endDate">End Date</Label>
                <Input
                  id="endDate"
                  type="date"
                  value={form.endDate}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      endDate: event.target.value,
                    }))
                  }
                  required
                />
              </div>
              <Button disabled={loading} type="submit">
                {loading ? "Submitting..." : "Create Quote"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="h-full">
          <CardHeader>
            <CardTitle>Policies</CardTitle>
            <CardDescription>
              Track the policy lifecycle across active submissions.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between pb-3 text-sm text-muted-foreground">
              <span>{loading ? "Refreshing..." : `${policies.length} policies`}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => loadPolicies({ notify: true })}
              >
                Refresh
              </Button>
            </div>
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Policy</TableHead>
                    <TableHead>Holder</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Premium</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {policies.map((policy) => {
                    const nextOptions = nextTransitions(policy)
                    const hasNext = nextOptions.length > 0
                    return (
                      <TableRow key={policy.id}>
                      <TableCell>
                        <div className="text-sm font-semibold">
                          {policy.policyNumber}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Eff. {policy.effectiveDate}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          End. {policy.endDate}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {policy.holderName}
                      </TableCell>
                      <TableCell>{statusBadge(policy.status)}</TableCell>
                      <TableCell className="text-sm">
                        ${(policy.premiumCents / 100).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <select
                            className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground shadow-sm transition focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
                            defaultValue=""
                            disabled={loading || !hasNext}
                            onChange={(event) => {
                              const nextState = event.currentTarget
                                .value as "approved" | "active" | "inactive" | "declined"
                              if (!nextState) {
                                return
                              }
                              const action = transitionActionForStatus(nextState)
                              void transitionPolicy(
                                policy.id,
                                action,
                                nextState === "approved"
                                  ? policy.effectiveDate
                                  : undefined
                              )
                              event.currentTarget.value = ""
                            }}
                          >
                            <option value="" disabled>
                              {hasNext ? "Next state..." : "No transitions"}
                            </option>
                            {nextOptions.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                className="inline-flex h-8 w-8 items-center justify-center rounded-full border text-[10px] font-semibold text-muted-foreground transition hover:text-foreground"
                                aria-label="View current status"
                              >
                                ?
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="left" align="center">
                              <p className="text-xs">
                                {statusExplanation(policy.status)}
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      </TableCell>
                      </TableRow>
                    )
                  })}
                  {policies.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                        No policies yet. Create a quote to get started.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  )
}
