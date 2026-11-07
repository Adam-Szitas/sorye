# README structure steering for agents

Apply this guidance whenever creating or substantially updating a main `README.md` for the repository or an app/package. Keep the README useful to people first; it is an entry point, not a copy of the full technical documentation.

## 1. At a glance

Start with a very brief, plain-language explanation of what the app does and how it currently works. Include a compact visible diagram that a human can understand quickly. Prefer a small Mermaid flowchart when it renders in the hosting platform; otherwise use a short ASCII diagram. Show the real runtime path and major owners (for example: person → Hub → app → API/data service). Label the connections in everyday language. Avoid implementation details, speculative components, and dense diagrams in this section.

Keep this opening section short enough to scan in under a minute. It should answer: what is this, who uses it, and what happens when they use it?

## 2. How it works

Follow the brief overview with a deeper explanation and a second useful visual specific to the app. Explain the current runtime components, boundaries, important integrations, and where state is owned or stored. Use a Mermaid sequence, component, or data-flow diagram when it makes the app's actual behavior easier to understand. Keep diagrams focused and label arrows with the action or data that crosses the boundary.

Separate current behavior from planned architecture. Do not imply that a planned integration is already active. Link to focused guides for setup, operations, API contracts, security, and development rather than duplicating them in the README.

## Content and maintenance

- Make both sections consistent with the implementation and relevant architecture/behavior documentation.
- Keep the first section human-readable and jargon-light; define necessary technical terms in the deeper section.
- Use accessible Mermaid labels and provide a brief textual explanation adjacent to each diagram so readers who cannot view it still get the flow.
- Keep existing practical sections such as quick start, configuration, development, and links after these two overview sections where they fit.
- Do not force an app-specific diagram into a package README when that package has no runtime app flow. In that case, show its role and the important modules or data flow it supports.
