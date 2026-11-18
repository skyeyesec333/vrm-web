# Motion data licences: a checklist before a commercial site uses it

This is a way to read a vendor's terms with the user, not legal advice. Say what the terms appear to say, quote the lines, and leave the decision to the user (or their lawyer).

## Why it matters

A portfolio, studio or product site that shows the work to win clients is **commercial promotion**, even if nothing is sold on the page. Many motion sources are free or cheap for personal use and need a paid tier for that.

## Read, for every source of motion (mocap marketplace, AI motion tool, Mixamo, a friend's capture)

1. **The tier you downloaded under.** File names often say it (`[standard] dance.fbx`). Find that tier on the vendor's licence page. "Non-commercial", "personal use only" or "no other commercial activity" means the site needs an upgrade (usually available per item).
2. **"No AI use" clauses.** Usually narrow: a ban on training, fine-tuning or evaluating AI models with the data. Putting motion on a character (even one made with AI tools) is normally not what it covers. Read the exact wording.
3. **Disclosure or credit.** Some terms require a line when output is used for commercial promotion (soliciting or selling commissions), e.g. "Base motion source: <vendor> (<url>)". If required and the user doesn't want a visible credit, the alternative is a different source or licence, not omitting it.
4. **Redistribution.** Terms often forbid sharing files "in a form from which the original can be extracted". A site serving converted, trimmed `.take` files is closer to embedding than redistribution, but it is a grey area: say so.
5. **Choreography.** Mocap of a real song's choreography (a K-pop dance, a challenge dance) carries the choreographer's and label's rights, which a mocap vendor usually says it cannot grant. The user must secure those separately or choose original choreography.
6. **Evidence and fingerprints.** Vendors may ask for evidence of use. Source files can carry the vendor's or capture studio's names in metadata; the converted files from this skill carry none, but a hidden fingerprint in the motion curves cannot be ruled out.
7. **The avatar itself.** A downloaded or bought VRM carries its own licence in its meta (who may use it, commercial use, redistribution, modification, credit): read it (`vrm_pack.py --dry-run` prints the personal fields; three-vrm exposes the rest as `vrm.meta`). Parts bought separately (hair, outfits, textures from a marketplace) have their own terms, which may forbid commercial use or redistribution inside a model file served to every visitor.
8. **Music.** The song the character dances to has its own licence (and an AI-generated track has its provider's terms): check it the same way.

## Write down

For each source: vendor, item, tier, the licence page URL and date read, what it permits for a commercial site, any credit line required, and what the user decided. Keep it beside the source files, not on the site.
