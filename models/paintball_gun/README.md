# Paintball gun model slot

The game currently loads the Fennec model at this exact path:

```text
models/paintball_gun/mw_2019_fennec_vipers_gmod_mw_base.glb
```

The first-person model, arms, and embedded animations load from this GLB. The game plays the **reload** clip when the player presses **R**; the clip duration sets the reload time. Keep the GLB self-contained (embed its textures during export). The first-person paintball shot origin is manually positioned on the camera-carried gun rig in `paintball.html` at `gunMuzzle.position`; adjust its local X, Y, and Z values to line the bullet up with the visible muzzle. Character-held copies filter out the first-person arms.

If replacing this asset, include an animation clip named **Reload** (case-insensitive) or another clip with `reload` in its name. If no reload-named clip exists, the game uses the first animation clip; if there are no clips, it keeps the default 1.05-second reload timer.

If the file is absent or fails to load, the built-in marker remains visible and match start is disabled. Reload the game after adding or replacing the GLB.
