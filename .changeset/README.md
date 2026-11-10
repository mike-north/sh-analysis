# Version preparation

This project stays in the 0.x series until the maintainer declares the API stable.
There is no override flag. Never request a `major` bump, including for breaking
changes: use `minor` for breaking changes while the API is taking shape.

Run `pnpm exec changeset` for package changes. Tooling-only changes do not require
a changeset. Run `pnpm version:prepare` to check the policy, consume changesets,
update package versions and generate `CHANGELOG.md`. Review and commit that
preparation before manually dispatching Release on main with the exact prepared
version. Preparation does not publish or tag anything.

CI rejects major declarations, public manifests outside 0.x, and Changesets
release plans outside 0.x. Release repeats these checks before npm publication.
