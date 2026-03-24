import { createFileRoute, redirect } from "@tanstack/react-router";
import { DocsPageView, loadDocsPage, preloadDocsPage } from "@/lib/docs-page";

export const Route = createFileRoute("/$")({
  component: Page,
  loader: async ({ params }) => {
    const slugs = params._splat?.split("/").filter(Boolean) ?? [];
    if (slugs[0] === "docs") {
      const nextPath = `/${slugs.slice(1).join("/")}`.replace(/\/+$/, "") || "/";
      throw redirect({ to: nextPath });
    }
    const data = await loadDocsPage({ data: slugs });
    await preloadDocsPage(data.path);
    return data;
  },
});

function Page() {
  return <DocsPageView data={Route.useLoaderData()} />;
}
