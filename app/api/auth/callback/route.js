import { terminarLogin } from '@/lib/authRutas';

export async function GET(req) {
  return terminarLogin(req);
}
