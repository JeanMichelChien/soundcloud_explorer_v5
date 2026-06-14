import { NextResponse } from "next/server";
import demo from "../../../../data/demo/graph.sample.json";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(demo);
}
