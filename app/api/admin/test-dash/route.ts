import { getDashboardData } from '@/lib/data/dashboard-data';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const data = await getDashboardData();
    return NextResponse.json({ count: data.length, sample: data[0] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message, stack: err.stack });
  }
}
