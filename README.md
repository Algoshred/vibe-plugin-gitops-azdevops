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
