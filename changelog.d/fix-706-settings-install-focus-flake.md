### Internal

- **The Settings install-steps arrival test no longer fails about 1 run in 100 with focus on
  `<body>`.** It checked focus the moment `findByRole` found the heading, but the page moves focus
  in an effect that React runs in a later task, so the check sometimes ran first. It now waits for
  focus. `docs/agents/merging.md` lists the failure's signature and remedy among the reds that
  aren't the PR's code. (#706)
