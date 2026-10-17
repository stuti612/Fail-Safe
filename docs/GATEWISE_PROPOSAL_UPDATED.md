# Final proposal: GATEWISE

**Track:** Ports & Logistics (Terminal49)  
**Decision seat:** the terminal planner at a hypothetical Port of Los Angeles container terminal  
**One sentence:** GATEWISE turns conflicting container records and lost gate capacity into a safe, explainable move plan: clear boxes keep moving, exceptions go to the right person, and a warming refrigerated box gets attention without bypassing a hold.

## The decision

At the brief's “one box, four stories” moment, the carrier lists a container as empty, a terminal scale shows it is heavy, a customs hold appears, and its refrigeration plug reports warming. Two of four gate lanes fail while many other boxes approach their pickup slots. The terminal planner must decide what can proceed through the remaining lanes, what should wait, and who must resolve the conflict. **No software in the demo releases a customs-held box or commands terminal equipment.** It creates a simulated plan and timestamped exception tasks for human review.

The product lives on **Slow + Hand**. It slows or reschedules eligible moves to fit the safe gate capacity and hands conflicting, time-sensitive cases to a named human. Legal and operational holds are hard eligibility constraints, not another autonomous “rung.” A blanket terminal closure is avoided when unaffected boxes can move safely.

## Why this is LA-specific and dual-use

The [Port of Los Angeles handled 10.2 million TEUs in 2025](https://portoflosangeles.org/business/statistics/facts-and-figures). Its [cold-storage network handles fruit, meat, fish and other perishables](https://www.portoflosangeles.org/maritime/refrigeration_storage.asp). This makes daily gate delays and cold-chain exceptions plausible local problems, while a lane outage creates the crisis version of the same decision. The same planner, data reconciliation, rules, and gate schedule are used both days.

**Ordinary Tuesday customer:** a terminal operations planner trying to reduce avoidable truck waits, demurrage exposure, and refrigerated-cargo dwell. A drayage dispatcher would receive an approved pickup change in a later pilot; the demo sends none. **Crisis customer:** that same planner, the gate supervisor, reefer technician and authorized hold-source representatives managing partial failure. GATEWISE is proposed for an operator like a Port of LA terminal; no terminal, port, or Terminal49 partnership is claimed.

The benefit to residents is **regional and indirect**: reliable movement of food and other goods and less avoidable truck waiting near port communities. A simulation can estimate queue time; it cannot claim measured air-quality or health improvement. The plan must serve Wilmington and San Pedro residents as well as cargo owners when a real pilot is designed. It cannot claim that every LA resident directly uses or receives a service from the app.

## What the working product does

1. **Replay source-specific facts.** The first submission seeds 30 synthetic carrier-manifest, terminal-scale, single mock customs-hold, reefer, appointment and lane records; a button can double the case to 60. The display preserves the distinct source and timestamp of each changed field. [Terminal49 documents availability, holds, last free day and milestones](https://help.terminal49.com/articles/1702836725-container-dashboard-columns-their-definitions), but a real scale and reefer feed would need separate authorized integrations. The demo has no live API ingest.
2. **Treat uncertainty as a block.** The carrier's “empty” claim does not erase the heavy scale reading. The warming reefer and mock customs hold are separate unresolved exceptions. Taking the hold feed offline stops every new slot; reconnecting it alone still stops slots until a separate fresh **mock hold-source fixture** is received. [Terminal49 distinguishes hold sources and requires a release from the relevant source](https://help.terminal49.com/articles/7161097937-hold-and-fees-types-their-definitions). The demo models one synthetic hold, not Terminal49's full multi-source hold model or authenticated customs authority.
3. **Propose feasible new slots.** A deterministic rule uses four or two lanes at four synthetic slots per lane per hour. It ranks eligible boxes by seeded last-free-day risk, then fits each box no earlier than its seeded appointment. The proposed plan never exceeds lane capacity and does not include a held box. Planner approval checks that the viewed plan's event revision is still current. The prototype does not control truckers or alter a real appointment system.
4. **Put exceptions in human hands.** LA-0001 needs three independent mock events: a customs release, carrier correction and reefer service check. The operator can record a simulated acknowledgement by a named on-duty responder. If the reefer technician becomes unavailable, their acknowledgement is invalidated, the task returns to unowned, and a gate-supervisor coverage task appears. No held box is sent to a public road or another storage area by this app.
5. **Show the tradeoff.** The console and JSON export compare GATEWISE's safe planned-slot count against a hold-all count of zero and show the minimum total-capacity excess from booking every eligible box. They report held boxes in plan, appointment violations, synthetic planned wait, and unowned tasks. They do not establish actual truck delay, emissions, reefer spoilage or a funding benefit-cost case.

This is more than a container-tracking dashboard. [Terminal49 already surfaces holds and pickup availability](https://help.terminal49.com/articles/3399363546-address-containers-waiting-at-the-terminal); GATEWISE's distinct function is to reconcile contradictory sources, enforce hard release constraints, and produce a capacity-aware, human-approved plan when lanes fail.

## People who must be available

| Person | Decision/service | If unavailable |
|---|---|---|
| Terminal planner | Reviews and approves the lane plan and requests a responder acknowledgement | A changed plan cannot reuse the previous approval; new uncertain boxes are unscheduled. |
| Gate supervisor | Confirms actual lane capacity and safe yard movements | Capacity is marked unknown; no new move instruction is issued. |
| Customs/authorized hold source | Provides explicit release/hold status in a real pilot | Held or unknown-release box remains blocked; the demo's mock button has no official authority. |
| Scale clerk | Rechecks the heavy/empty contradiction | Box remains an exception; manifest is not treated as truth. |
| Reefer technician | Checks the warming plug and reports action | The demo removes their mock ownership and creates a gate-supervisor coverage task; temperature risk stays open. |
| Drayage dispatcher/trucker | Confirms a changed appointment once approved | Schedule shows unconfirmed; the demo does not dispatch a truck. |

## First-submission demo

**Working build:** a local Python web app with 30/60 seeded synthetic boxes, a deterministic one-hour scheduler, and a SQLite event/audit log. The judge clicks **“Lose two lanes.”** Proposed new slots fit the reduced capacity and each box's appointment. LA-0001 stays blocked by its hold, weight conflict and warming sensor. The judge can acknowledge mock responders, make the reefer technician unavailable, or take the hold feed offline. A restored feed alone does not clear anything: the judge must explicitly receive a separate fresh mock hold-source fixture. Three independent mock resolution events make LA-0001 eligible. Plan approval records the viewed revision and persists after refresh; a later plan event marks it stale.

Use the deterministic 30-box seed, then show the optional 60-box surge. No map, freight marketplace, truck dispatch or real customs integration is needed for the first submission. The source buttons are explicitly synthetic, and the app is decision support only.

**Demo acceptance:** resetting yields the same plan; zero held boxes and zero boxes scheduled before their appointments appear in the plan; reducing lanes lowers capacity; a reconnected feed with no fresh mock snapshot still blocks proposals; a warming reefer has an unowned task until a mock responder acknowledges it; an unavailable responder loses ownership and cannot record a check; approval rejects a stale revision. Nine policy tests currently pass, and the browser flow has been exercised locally.

**Street-spill guard:** if the gate is over capacity, the app limits *new recommendations*; a real gate supervisor must use the terminal's approved traffic and staging procedure for trucks already inbound. It does not assume that trucks can wait on Wilmington or San Pedro streets or that a legal off-street holding area exists. No street-spill reduction is measured in the demo.

## Twist response

Each actual twist gets a changed scenario input, a guard check, a regression case and a before/after clip. The current build already handles lane loss, hold-feed failure, a 30-to-60-box surge and reefer staff absence. These are candidates for later twists, not claimed current features:

| Twist type | Built behavior to show |
|---|---|
| Another lane or power loss | Add a 0/1-lane or reduced-power event; zero capacity must yield zero new slots. |
| Missing scale or temperature source | Add an unknown/stale state and block affected boxes until a new mock source event. |
| Verified priority change | Add a documented category only among eligible boxes; hard holds remain. |
| Staff missing | Already implemented for the reefer technician; extend the same roster rule to the named role in the twist. |
| Larger surge | Increase the seeded case beyond 60 and test runtime and backlog without weakening release rules. |

## Twist #1: federal funding pathway

**Potential direct R&D path — NSF America's Seed Fund, SBIR Phase I.** A qualifying U.S. small business could seek an [NSF SBIR Phase I award of up to $305,000 for 6–18 months of R&D](https://www.nsf.gov/funding/opportunities/small-business-innovation-research-small-business-technology/nsf26-510/solicitation). The application starts with an [NSF Project Pitch and an official invitation](https://seedfund.nsf.gov/apply/project-pitch-information/) before a full proposal. The startup must meet the solicitation's small-business and principal-investigator rules. The November 4, 2026 full-proposal date is **not an automatic application opportunity** for a new team; NSF says Project Pitch responses typically take one to two months. We would target an invited future round, subject to the program's schedule and proof of research novelty.

**Specific research to fund:** test whether a source-aware, safety-constrained planner can preserve hard release rules while receiving delayed, contradictory and missing carrier, terminal and reefer events, and still improve throughput against a simple hold-all or first-in-first-out baseline. Phase I experiments would use partner-approved historical/synthetic traces, quantify false-clearance risk, queue delay and exception time, and test a replayable explanation of every decision. A normal dashboard or straightforward scheduling code is insufficient for NSF: [NSF requires substantial, unproven technical R&D](https://seedfund.nsf.gov/apply/project-pitch-information/). If completed, the hackathon prototype would be an initial test harness; the novel method and commercial demand must be established before a Project Pitch. No grant or invitation is currently held.

**Alternative public deployment path — USDOT MARAD Port Infrastructure Development Program (PIDP).** [MARAD lists freight digital infrastructure and port resilience as eligible project types](https://www.maritime.dot.gov/PIDP%20Grants/FAQs). A public port authority or other eligible public lead could apply jointly with a terminal/private partner for a future eligible project in which GATEWISE might be one competitively procured component. A standalone software subscription is not automatically fundable, and GATEWISE alone is **not** an eligible public lead. The FY2026 application deadline was June 1, 2026, so this is a future-cycle possibility. A port partner, site permissions, benefit-cost evidence, procurement and cybersecurity requirements, and award terms would have to be satisfied.

**Commercial bridge:** use the Saturday demo to seek a terminal or drayage operator design partner and obtain permission to test on de-identified historical events. If the research risk is real and customer need is documented, submit the NSF Project Pitch. If the technology proves useful, sell a planner software pilot to a terminal operator or participate in an eligible public-lead PIDP project. Neither public funding path is represented as assured revenue.

**Visible Twist #1 build change:** the working demo exports a fixed-seed **synthetic decision trace** with source events, timestamps, gate capacity, safe planned slots, blocked boxes, appointment violations, planned wait, unowned tasks, and same-case hold-all/capacity-blind count comparisons. A regression test checks the export. It is an initial measurement design for an NSF research pitch or later port study, **not grant-ready pilot evidence**, measured truck delay or a benefit-cost analysis.

**Paste-ready Twist #1 response:** “Our alternative federal launch pathway is NSF SBIR Phase I (America's Seed Fund): up to $305,000 for 6–18 months, conditional on a qualifying U.S. small business and genuinely novel, high-risk R&D in safety-constrained planning with contradictory port data. We must first submit an NSF Project Pitch and receive an invitation; we have neither yet. A later public deployment pathway could be MARAD's Port Infrastructure Development Program through an eligible public port lead, with GATEWISE considered as a competitively procured component of an eligible project; its FY2026 deadline has passed. The working demo exports a synthetic decision trace comparing safe planned slots with hold-all and capacity-blind counts. Real partner data and a research result are still needed before either funding case.”

## Submission positioning

**Thirty-second opening:** “One box says empty, the scale says heavy, customs says hold, and its refrigeration plug says warming. Half the gates just failed. GATEWISE gives the terminal planner a safe plan: propose slots only for boxes whose simulated release and checks are clear, and put the conflicted box in front of the people who can resolve it. The same workflow helps with ordinary appointment pileups, so it can be in use before a disruption hits.”

**Working-demo order:** reset the seeded conflicting box → show its four sources and three blocking reasons → lose two lanes → show capacity-safe slots → confirm a mock responder → take the hold feed offline → reconnect it and show proposals still stopped → receive the fresh mock hold snapshot → receive the three independent resolution events → approve the current plan → export the synthetic decision trace. Keep this sequence live and record it for the submission video.

## Limits and responsible use

All demo boxes, people, values and events are synthetic. Real deployment would need a terminal agreement, data rights, distinct hold sources, authenticated event senders, source freshness rules, lane and labor rules, cybersecurity review, customs/USDA workflows, and measured lane rates. A planner recommendation is not a release authorization. Sensitive shipment details should be minimized and role-restricted. The prototype's append-only event history and revision-checked approval make changes visible; they are not a production security or legal-authorization system. No freight movement is controlled by this build.

## Why choose it over the other non-comms track

Compared with [KEEPALIVE](Proposal-2-KEEPALIVE.md), GATEWISE has a more direct path from the brief's exact “one box, four stories” scenario to a visible, working decision and a larger regional supply-chain context. KEEPALIVE has a simpler asset model and direct benefit for enrolled homes, but its LA battery fleet is hypothetical and its protection is limited to connected households. The Ports sponsor explicitly accepts mock data in its technical-depth criterion; that suits a deterministic first-submission demo. Neither proposal can honestly claim universal direct coverage of LA residents.
