import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/docs/$")({
  loader: ({ params }) => {
    const nextPath = params._splat ? `/${params._splat}` : "/";
    throw redirect({ to: nextPath });
  },
});
