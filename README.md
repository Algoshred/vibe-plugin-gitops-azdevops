# @vibecontrols/vibe-plugin-gitops-azdevops

Azure DevOps provider for the [`@vibecontrols/vibe-plugin-gitops`](https://npmjs.com/package/@vibecontrols/vibe-plugin-gitops) meta plugin.

## Install

```bash
vibe plugin install @vibecontrols/vibe-plugin-gitops          # meta (once)
vibe plugin install @vibecontrols/vibe-plugin-gitops-azdevops
```

## Auth

Personal Access Token (PAT) with these scopes (https://dev.azure.com/{org}/_usersSettings/tokens):

- Code: read
- Pull Request: read
- Build: read
- Release: read (optional)
- Security: read (optional)

```bash
curl -X POST "${AGENT_URL}/api/profiles/default/gitops/azdevops/auth" \
  -H "x-agent-api-key: $KEY" \
  -d '{
    "kind": "pat",
    "token": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "meta": { "organization": "my-org" }
  }'
```

The `meta.organization` field is required — Azure DevOps APIs are scoped per organisation.

## Repo FQN

Azure DevOps FQN format: `{organization}/{project}/{repo}` (3 segments).

## License

Proprietary — see LICENSE.

<!-- VIBECONTROLS_OSS_FOOTER_START -->

---

## About VibeControls

**VibeControls** is the agentic engineering mission control for AI-native teams. Vibe-plugins extend the VibeControls agent with new providers, tools, sessions, tunnels, storage backends, and security stages.

- Website: <https://vibecontrols.com>
- Documentation: <https://docs.vibecontrols.com>
- Plugin SDK: <https://github.com/algoshred/vibecontrols-plugin-sdk>
- All plugins: <https://github.com/algoshred?q=vibe-plugin-&type=all>

## Credits

This plugin builds on the following upstream open-source projects. All trademarks and copyrights remain with their respective owners.

- **Azure DevOps REST API** — <https://learn.microsoft.com/rest/api/azure/devops/>

## License

Released under the [MIT License](./LICENSE).

Copyright (c) 2026 Burdenoff Consultancy Services Private Limited, Algoshred Technologies Private Limited, and all its sister companies.

Maintainer: **Vignesh T.V** — <https://github.com/tvvignesh>

**Note**: this plugin is open source under MIT. The `@vibecontrols/agent` runtime that loads and orchestrates plugins is **closed source** and proprietary to Burdenoff Consultancy Services Pvt. Ltd. If you want a fully self-hostable agent, please open an issue or contact the maintainer.

<!-- VIBECONTROLS_OSS_FOOTER_END -->
