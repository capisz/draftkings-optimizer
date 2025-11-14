import { NextResponse } from "next/server";

export const runtime = "nodejs"; // explicit runtime

export async function GET() {
  return NextResponse.json({ ok: true, at: "/api/ok" });
}
