import { createFileRoute } from "@tanstack/react-router";
import { DocsPageView, loadDocsPage, preloadDocsPage } from "@/lib/docs-page";

export const Route = createFileRoute("/")({
  component: Page,
  loader: async () => {
    const data = await loadDocsPage({ data: [] });
    await preloadDocsPage(data.path);
    return data;
  },
});

function Page() {
  return <DocsPageView data={Route.useLoaderData()} />;
}
