import { cerrarSesion } from '@/lib/authRutas';

export async function POST() {
  return cerrarSesion();
}
