import { Link, useParams } from "react-router";
import { isDynasty } from "../api/sleeper.ts";
import { ErrorMessage, Loading } from "../components/Status.tsx";
import { useLeagues, useNflState, useUser } from "../hooks/queries.ts";

export default function Leagues() {
  const { username = "" } = useParams();
  const state = useNflState();
  const user = useUser(username);
  const leagues = useLeagues(user.data?.user_id, state.data?.season);

  if (state.error || user.error || leagues.error) return <ErrorMessage error={state.error ?? user.error ?? leagues.error} />;
  if (user.data === null) return <p>No Sleeper user named “{username}”.</p>;
  if (!leagues.data) return <Loading label="Loading leagues" />;

  const dynasty = leagues.data.filter(isDynasty);
  const skipped = leagues.data.length - dynasty.length;

  return (
    <section>
      <h2 className="mb-3 text-lg font-medium">
        {user.data!.display_name}’s dynasty leagues ({state.data!.season})
      </h2>
      {dynasty.length === 0 && <p className="text-slate-400">No dynasty leagues this season.</p>}
      <ul className="space-y-2">
        {dynasty.map((l) => (
          <li key={l.league_id}>
            <Link
              to={`/league/${l.league_id}?user=${user.data!.user_id}`}
              className="block rounded border border-slate-800 px-4 py-3 hover:border-emerald-600"
            >
              <span className="font-medium">{l.name}</span>
              <span className="ml-2 text-sm text-slate-400">{l.total_rosters} teams</span>
            </Link>
          </li>
        ))}
      </ul>
      {skipped > 0 && <p className="mt-3 text-sm text-slate-500">{skipped} redraft or keeper leagues hidden.</p>}
    </section>
  );
}
