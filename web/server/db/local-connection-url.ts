export function createLocalDatabaseUrl(role: string, password: string): string {
  const url = new URL("postgresql://localhost:5432/onholidai");
  url.username = role;
  url.password = password;
  return url.toString();
}
