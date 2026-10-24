/**
 * Workspace route at /workspace. It renders the empty two-column layout and
 * nothing else. It does not read accounts, list charges, search policy, queue
 * refunds, or check a login session.
 */

import { Workspace } from "../../components/Workspace";

export default function WorkspacePage() {
  return <Workspace />;
}
