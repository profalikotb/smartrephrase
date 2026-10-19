import { sessionStatus } from "@/lib/server/auth-routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = sessionStatus;
