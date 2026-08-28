import ReconciliatorApp from "@/components/ReconciliatorApp";

export default async function Page({ searchParams }: PageProps<"/">) {
  const params = await searchParams;
  const connectedParam = params.connected;
  const errorParam = params.error;

  const initialConnected = (Array.isArray(connectedParam) ? connectedParam[0] : connectedParam) === "1";
  const initialOauthError = (Array.isArray(errorParam) ? errorParam[0] : errorParam) ?? null;

  return <ReconciliatorApp initialConnected={initialConnected} initialOauthError={initialOauthError} />;
}
