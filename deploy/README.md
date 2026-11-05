# App images and Dockyard

**Hub is the app-facing gateway, not the intended domain backend.** The target is apps <-> Hub <-> Rodrigo. Existing Hub data/event code remains pending migration. This workflow does not build Rodrigo; release it separately and record compatible Hub/Rodrigo digests and contract versions. See [ownership, current gaps and release ordering](../docs/HUB-RODRIGO-BOUNDARY.md).

Run the Forgejo publish workflow with the existing registry credentials and remote URL variables. Set each `NEXT_PUBLIC_<APP>_REMOTE` to `https://<slug>.sorye.app/remote/remoteEntry.js`. These are Hub build inputs. The workflow publishes Hub plus twenty app images and prints their registry digests. Use the printed digest, never a mutable tag, for promotion. The build runner architecture must match the target VM.

Remote apps have their own compiled assets. Other app images are gateways; their UI still executes from Hub. SUSM and ESPM retain external service ownership. Contact uses its existing public presentation route. This is independent frontend delivery, not backend isolation or extraction of Hub-native UI.

On each target, provision DNS/TLS and route each exact app hostname to its corresponding loopback port in `dockyard-<slug>.compose.yml`. Only a trusted HTTPS ingress may reach gateways: they forward HTTPS scheme and the incoming hostname to Hub. Reject unknown hosts at ingress. Set `HUB_UPSTREAM` to the privately reachable Hub address, not container-local localhost. Register Google's callback `https://<slug>.sorye.app/api/auth/callback/google` for each login-enabled app. Leave `AUTH_URL` unset so Auth.js uses the forwarded origin. Sessions are host-only: each app signs in on its own origin; no broad domain cookie is introduced. Hub must remain private behind trusted gateways because it trusts forwarded hosts.

Keep `/learn/...` available for public introductions. Do not configure root app hosts to reach Hub directly, which retains the older introduction redirect. Gateway `/` redirects to the app route; login callbacks and subsequent reloads retain that route.

Authenticate the Dockyard service account to the private registry. Set `SORYE_APP_IMAGE` to the initial digest, `SORYE_APP_PORT` if overriding its default, and `HUB_UPSTREAM` in the administrator/service environment. Keep these values stable after registration. Register separately:

```sh
dockyard add sorye-tasks /srv/sorye/deploy/dockyard-tasks.compose.yml web
dockyard deploy sorye-tasks registry.example/team/sorye-tasks@sha256:<digest>
```

Repeat for each app. Register Hub separately using `dockyard-hub.compose.yml`; supply its image and target-owned env file. Prepare Hub's database, object storage and workers separately. The Hub volume preserves remaining file-backed metadata; this does not make multiple Hub writers safe. Back up and restore-test it.

Dockyard applies one digest to every service in a registration. Never register different app images together. It updates with `--no-deps`; it does not provision ingress, databases, workers or credentials. Run `docker compose -f <file> config --quiet` before registering. Keep Compose project names stable. Promotion is an explicit `dockyard deploy` or `dockyard ship` action after publication; this workflow does not deploy automatically. Review the printed digest and promote each app independently. Dockyard's previous healthy release provides image rollback, not data rollback.

Gateway healthchecks prove the web process is alive, not authenticated end-to-end readiness. Before promotion, check login, workspace access, remote assets, a save/reload and an unauthorized workspace request through every public hostname. Test a failed deployment and recovery on a disposable target first.
