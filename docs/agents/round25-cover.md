# Round 25 brief: cover art that pops

Ty compared our cover against the CrazyGames Action category: "The cover needs to POP a lot more." Our current hero
cover is a calm, front-on Mage with a neutral face standing in the courtyard, under a serif title. Next to the
competition it reads as a screenshot, not key art.

## What the top covers do
Most are painted or AI-generated illustrations, made with tools like Midjourney or ChatGPT image generation, or
commissioned art, sometimes over a 3D render. They share these traits:
- **One hero, big, close, mid-action:** an exaggerated pose and expression (shouting, grinning, determined), a leaning
  diagonal body line, often an arm or weapon thrust toward the viewer (foreshortening).
- **A clear antagonist or target**, being hit or about to be.
- **Huge, saturated VFX:** glowing beams, explosions and particles that light the characters (rim light in the effect's
  colour).
- **Saturated colour and contrast:** a complementary pair (orange against blue or purple), a darker vignette, a bright
  focal point.
- **A chunky "game logo" title:** a heavy, rounded display font, thick dark outline, a vertical gradient fill (yellow to
  orange), a 3D extrusion or drop shadow, a slight tilt. It's readable at thumbnail size (about 300 px wide) and placed
  in an empty part of the frame.
- **Little background detail:** a blurred, colour-graded background so the subject reads at a glance.

## What to make (characters agent: staging and posing; reuse deploy/capture_store.py's staging hooks)
Make a staged **in-engine key-art render**, then a composited title, as `cover-action-*` in three sizes (1920×1080,
800×1200, 800×800):
- **Composition:**
  - The **Pyromancer Mage**, big, in the left or centre foreground, at a low three-quarter angle (the camera slightly
    below the face). The body leans into a cast, captured at the thrust frame of the cast or Meteor clip, with the staff
    pointed toward the right of the frame.
  - Expression: use the most energetic frame the rig allows. If the face can't change, tilt the hat and head down for
    a determined look.
  - A **massive Fireball or Meteor** mid-flight from the staff toward a **Skeleton** on the right, which is caught
    reacting (the Hit or Death_A frame) with explosion sparks. Optionally a second wizard (an ice or Hex colour) in the
    background, for more action.
  - **Lighting:** a strong orange point light at the fireball lighting both characters, a cool blue or purple rim from
    behind, and the sky darkened toward dusk purple.
  - **Post-processing:** bloom on the spell (render at 2× and composite, or the EffectComposer UnrealBloom if it's in
    the vendor tree), saturation +20–30%, contrast, a vignette, a slight depth-of-field blur on the background, and
    motion or speed streaks behind the fireball.
- **Title:** "WIZARD ARENA" as a **chunky game logo**:
  - a heavy rounded display font (a Google font such as Luckiest Guy, Lilita One or Titan One; the font file isn't
    shipped in the game, it's only used for the image)
  - a gold-to-orange gradient fill and a thick dark purple outline
  - a stacked 3D extrusion plus a drop shadow, a slight upward tilt, and a small sparkle or magic glint
  - in the **top-right** for the landscape cover (clear of the top-left label zone, about 35% × 30%) and top or bottom
    centre for portrait and square, never under the label zone
  - readable at 300 px
- **Variants:** make 2–3 compositions (for example the Fireball-at-Skeleton duel, or Meteor Rain from above on the
  wall-walk) and pick the best by eye, at full size and shrunk to 300 px next to `/tmp/` copies of the competitor
  screenshot.
- **Rules:** no HUD, no borders and no extra text beyond the title (CrazyGames cover rules). It must show the real game,
  so stage it in-engine; no invented creatures.
- **Output:** `deploy/crazygames/store/covers/cover-action-landscape-1920x1080.jpg`, `-portrait-800x1200` and
  `-square-800x800`. Keep the old covers. Commit the script (`deploy/capture_cover.py` or an extension of
  capture_store.py).

## Ty's alternative
For a painted look, a prompt for an AI image tool (ChatGPT image or Midjourney), using our render as the reference, is
written up in deploy-handoff.md. Ty decides.
