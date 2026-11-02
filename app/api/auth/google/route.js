import { iniciarLogin } from '@/lib/authRutas';

export async function GET(req) {
  return iniciarLogin(req);
}
