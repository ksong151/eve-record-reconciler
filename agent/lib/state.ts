import { defineState } from "eve/context";
import { emptyState, type ReconcilerState } from "./session.ts";

/** Per-session reconciliation state: loaded sources, mappings, and review decisions. */
export const reconcilerState = defineState<ReconcilerState>("record-reconciler.session", emptyState);
