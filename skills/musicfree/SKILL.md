---
name: musicfree
description: Use user-installed MusicFree-compatible plugins to search, resolve, and download music.
---

# MusicFree Bridge

Use this skill when the user asks OpenClaw to work with MusicFree-compatible
plugins or sources.

Workflow:

1. Use `musicfree_list_plugins` to inspect installed plugins when the request
   depends on available sources.
2. Use `musicfree_subscribe`, `musicfree_refresh_subscriptions`,
   `musicfree_list_subscriptions`, `musicfree_remove_subscription`, or
   `musicfree_install_plugin` only when the user asks to add, inspect, remove,
   or update plugins and subscriptions.
3. Use `musicfree_set_plugin_vars` when a plugin declares required
   `userVariables`.
4. Use `musicfree_search` to find candidates. Do not invent plugin names or
   candidate IDs.
5. If several candidates are plausible, show the user a short numbered list and
   ask which one to use.
6. Use `musicfree_resolve` before downloading so headers, user-agent, and
   quality are preserved.
7. Use `musicfree_download` for the selected candidate or resolved source.
8. Use `musicfree_lyrics` when the user asks for lyrics or when saving lyrics
   alongside a download is useful.
9. Use `musicfree_set_plugin_enabled` or `musicfree_remove_plugin` when the user
   asks to disable, re-enable, or remove a configured plugin.

Boundaries:

- This bridge does not include or recommend music sources.
- The user is responsible for the plugins and sources they configure.
- Do not bypass paywalls, DRM, account restrictions, or platform access
  controls.
