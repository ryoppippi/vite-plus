use std::future::Future;
use std::iter;

use petgraph::stable_graph::StableGraph;

use crate::config::ResolvedTask;
use crate::schedule::ExecutionPlan;
use crate::{Error, ResolveCommandResult, Workspace};

pub async fn doc<
    Doc: Future<Output = Result<ResolveCommandResult, Error>>,
    DocFn: Fn() -> Doc,
>(
    resolve_doc_command: DocFn,
    workspace: &mut Workspace,
    args: &Vec<String>,
) -> Result<(), Error> {
    let resolved_task = ResolvedTask::resolve_from_builtin(
        workspace,
        resolve_doc_command,
        "doc",
        iter::once("dev").chain(args.iter().map(std::string::String::as_str)),
    )
    .await?;
    let mut task_graph: StableGraph<ResolvedTask, ()> = Default::default();
    task_graph.add_node(resolved_task);
    ExecutionPlan::plan(task_graph, false)?.execute(workspace).await?;
    Ok(())
}