# ADR 0024: Dance flyers use public, versioned Storage objects

## Status

Accepted.

## Context

Dance details are public-readable, while only the owning instructor may change
their dance. A flyer has the same audience but needs binary storage, a five MiB
limit, image-only validation, and an ownership boundary that does not trust a
client-supplied instructor identifier. Replacing an object at one public URL can
also leave an old image in the Storage or Next Image cache.

## Decision

Flyers live in a public `dance-flyers` Supabase Storage bucket. Its bucket
configuration limits objects to JPEG, PNG, or WebP images up to five MiB. Object
paths are `<dance-event-id>/flyer-<version>`, and Storage write policies derive
ownership from that event ID via the existing `owns_event` function. Anonymous
users retrieve public object URLs but receive no object metadata-listing or
write policy. `dance_events.flyer_path` is the public read-path pointer.

Every replacement uploads to a new versioned path, updates the database pointer,
then removes the old object. The new URL prevents an already cached optimized
image from masking the replacement. If the pointer update fails, the client
removes the unattached new object and reports failure. If only old-object cleanup
fails, the valid new pointer and object remain and the UI reports that cleanup
warning instead of risking a broken public flyer.

## Consequences

Bucket setup and access rules deploy with the SQL migration; no dashboard-only
step is required. Storage and Postgres still cannot participate in one atomic
transaction, so compensating operations are best effort and a failed network
request can leave an unreferenced object for later operational cleanup. Public
read access is intentional and matches the dance read model in ADR 0010.
