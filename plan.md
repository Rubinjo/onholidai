/speckit-plan

Monorepo with the web application in `web` folder and the Python agent service in `agent` folder. The agent service is responsible for orchestrating the LLM and other tools to fulfill user requests. The web application is a Next.js app that provides the user interface for interacting with the agent.

## Core technology decisions

| Concern                      | Technology                                                 |
| ---------------------------- | ---------------------------------------------------------- |
| Web application              | Next.js App Router, React, TypeScript                      |
| Authentication               | Better Auth                                                |
| Validation                   | Zod (TypeScript), Pydantic (Python)                        |
| Frontend server state        | TanStack Query                                             |
| UI                           | Tailwind CSS, shadcn/ui, Radix UI                          |
| Interactive maps             | MapLibre GL JS                                             |
| Date and calendar UI         | React DayPicker, date-fns                                  |
| Database                     | PostgreSQL 18                                              |
| Geospatial data              | PostGIS                                                    |
| Agent orchestration          | Python, LangGraph                                          |
| LLM provider                 | Nebius Token Factory, through an OpenAI-compatible client  |
| Agent API                    | FastAPI                                                    |
| Background workflows         | Temporal, using TypeScript and Python SDKs                 |
| Caching and rate limiting    | Redis, introduced when justified                           |
| Unit and integration testing | Vitest, pytest                                             |
| End-to-end testing           | Playwright                                                 |
| Distributed tracing          | OpenTelemetry                                              |
| Agent tracing and evaluation | LangSmith                                                  |
| Local development            | Docker Compose                                             |
| CI/CD                        | GitHub Actions                                             |

## MCP integrations

- **Google Maps Grounding Lite MCP:** Place discovery, geographic context, current weather, and basic driving/walking routes.
- **Tavily MCP:** Web research for destinations, travel requirements, events, and recommendations.
- **First-party `travel-supply` MCP:** Unified provider interface with adapters for Duffel (flights), Booking.com Demand API (accommodation), GetYourGuide (activities), and Trainline Partner Solutions (rail).
- Separate read-only search from booking operations. Revalidate offers before booking, require explicit user authorization, and support idempotency and failure recovery.

## Agent tools

- `get_trip`: Retrieve the current trip snapshot or detailed trip information.
- `propose_trip_changes`: Translate natural-language requests into structured trip-change proposals. This tool MUST NOT directly modify authoritative trip state.
- `retrieve_relevant_context`: Retrieve relevant historical messages and decisions not captured in the conversation summary.

The application MUST validate proposals against current trip state and domain rules before applying them. Automatically apply valid, unambiguous changes to the draft itinerary where appropriate. Ask for clarification when ambiguity materially affects the result. Booking, payment, and other externally consequential actions require explicit authorization.

## Context management

- Preserve the complete conversation in persistent storage and include as much recent history as useful within the model's context budget.
- Provide a compact summary of the current trip, with `get_trip` available for additional details.
- Maintain a conversation summary containing `constraints`, `preferences`, `decisions`, `rejected_options`, and `open_questions`. Compact older history when context-window limits, cost, or quality justify it.
- Use `retrieve_relevant_context` to retrieve specific historical information missing from the summary.
- Keep stable instructions and tool definitions at the beginning of prompts, followed by conversation history and relevant dynamic context, to improve prompt-cache reuse where supported.