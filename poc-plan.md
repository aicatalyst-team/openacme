# PoC Plan: openacme

## Project Classification
- **Type:** llm-app
- **Key Technologies:** TypeScript, Node.js 18+, pnpm monorepo, Hono (HTTP server), React 19, Vite, Vercel AI SDK, SQLite (via drizzle-orm), Turborepo
- **ODH Relevance:** Demonstrates a multi-agent AI workforce platform deployed on OpenShift, validating that agentic AI orchestration workloads can run as managed platform services.

## PoC Objectives
1. Validate the Hono HTTP server backend can be built and deployed on OpenShift with UBI Node.js images
2. Confirm the health endpoint and API routes function correctly in a containerized environment
3. Demonstrate that the pnpm monorepo builds successfully in a container context

## Infrastructure Requirements
- **Resource Profile:** medium (1Gi RAM, 500m CPU)
- **GPU Required:** No
- **Persistent Storage:** None (ephemeral SQLite)
- **Sidecar Containers:** None
- **Deployment Model:** deployment (long-running Hono server)
- **Port:** 3456
- **LLM API Required:** No (health and metadata endpoints don't require LLM)

## Test Scenarios

### Scenario 1: health-check
- **Description:** Verify the Hono health endpoint
- **Type:** http
- **Endpoint:** GET /api/health
- **Expected:** Returns 200 OK with status JSON
- **Timeout:** 30 seconds

### Scenario 2: home-page
- **Description:** Verify the web UI serves correctly
- **Type:** http
- **Endpoint:** GET /
- **Expected:** Returns 200 with HTML content
- **Timeout:** 30 seconds

## Dockerfile Considerations
- Use `registry.access.redhat.com/ubi9/nodejs-22` as base image
- Install pnpm globally, then build the monorepo
- The server prepack copies web build output, so build web first
- Set OPENACME_DATA_DIR to a writable location
- Expose port 3456

## Deployment Considerations
- Deploy as a single Deployment with 1 replica
- Create ClusterIP Service on port 3456
- No secrets needed for basic health/UI testing
