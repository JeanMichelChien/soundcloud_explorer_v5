# Agent Notes

- Read `docs/adr/` before changing architecture, data contracts, deployment behavior, repository privacy policy, or test strategy.
- Keep the production app TypeScript/Next.js only. Do not add alternate app runtimes or committed full SoundCloud cache files.
- Treat `liked_artists.json`, `seed_artist_likes_cache.json`, generated graph HTML, and generated text exports as private local artifacts unless the user explicitly says otherwise.
