import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Header } from 'components';
import { getJobById, IJob } from '../../state/store.selectors';
import { Item } from '../../state/example.model';
import styles from './Detail.module.scss';
import Convert from 'ansi-to-html'; 

import Collapsible from 'react-collapsible';
import { ghHostApiUrl } from 'settings';

export interface DetailProps {
    item: Item | null
}

interface ILog {
    id: number,
    location: string
    content: string
}

interface ITimeLine {
    id: string,
    Type: string,
    log: ILog | null,
    order: Number,
    name: string,
    busy: boolean,
    state: string,
    result: string
}

// interface IJobEvent {
//     repo: string,
//     job: IJob 
// }

interface ILogline {
    line : string,
    lineNumber: number
}

interface IRecord {
    value: string[],
    stepId: string,
    startLine: number
    count: number
}

interface ILoglineEvent {
    recordId: string,
    record: IRecord
}

interface ITimeLineEvent {
    timeline: ITimeLine[],
    timelineId: string
}


// Artifacts

export interface ArtifactResponse {
    containerId: string
    size: number
    signedContent: string
    fileContainerResourceUrl: string
    type: string
    name: string
    url: string

    files: ContainerEntry[] | null
  }
  
  export interface CreateArtifactParameters {
    Type: string
    Name: string
    RetentionDays?: number
  }
  
  export interface PatchArtifactSize {
    Size: number
  }
  
  export interface PatchArtifactSizeSuccessResponse {
    containerId: number
    size: number
    signedContent: string
    type: string
    name: string
    url: string
    uploadUrl: string
  }
  
  export interface UploadResults {
    uploadSize: number
    totalSize: number
    failedItems: string[]
  }
  
  export interface ListArtifactsResponse {
    count: number
    value: ArtifactResponse[]
  }
  
  export interface QueryArtifactResponse {
    count: number
    value: ContainerEntry[]
  }
  
  export interface ContainerEntry {
    containerId: number
    scopeIdentifier: string
    path: string
    itemType: string
    status: string
    fileLength?: number
    fileEncoding?: number
    fileType?: number
    dateCreated: string
    dateLastModified: string
    createdBy: string
    lastModifiedBy: string
    itemLocation: string
    contentLocation: string
    fileId?: number
    contentId: string
  }

/**
 * Gets a list of all artifacts that are in a specific container
 */
async function listArtifacts(runid : number): Promise<ListArtifactsResponse> {
const artifactUrl = ghHostApiUrl + "/runner/host/_apis/pipelines/workflows/" + runid + "/artifacts"

const response = await fetch(artifactUrl);
const body: string = await response.text()
return JSON.parse(body)
}

/**
   * Fetches a set of container items that describe the contents of an artifact
   * @param artifactName the name of the artifact
   * @param containerUrl the artifact container URL for the run
   */
 async function getContainerItems(
    artifactName: string,
    containerUrl: string
  ): Promise<QueryArtifactResponse> {
    // the itemPath search parameter controls which containers will be returned
    const resourceUrl = new URL(containerUrl)
    resourceUrl.searchParams.append('itemPath', artifactName)

    const response = await fetch(resourceUrl.toString());
    const body: string = await response.text()
    return JSON.parse(body)
  }

// End Artifacts


export const DetailContainer : React.FC<DetailProps> = (props) => {
    const [ jobs, setJobs ] = useState<IJob[] | null>([]);
    const [ timeline, setTimeline ] = useState<ITimeLine[]>([]);
    const [ artifacts, setArtifacts ] = useState<ArtifactResponse[]>([]);
    const [ title, setTitle] = useState<string>("Loading...");
    const { id } = useParams();
    const { owner, repo } = useParams();
    const [ errors, setErrors] = useState<string[]>([]);


    useEffect(() => {
        (async () => {
            setArtifacts(_ => []);
            if(id === undefined) {
                return;
            }
            var njobs : IJob[] | null;
            var _id = Number.parseInt(id);
            if(jobs.length === 0 || jobs.find(x => x.requestId === _id) == null) {
                njobs = await (await (await fetch(ghHostApiUrl + "/" + owner + "/" + repo + "/_apis/v1/Message", { })).json())
                setJobs(njobs);
            }
            var query = getJobById(njobs || jobs, id);
            if(query.job.errors !== null && query.job.errors.length > 0) {
                setErrors(query.job.errors);
            } else {
                setErrors([]);
            }
            const item = query.item;
            const timelineId = item ? item.description : null;
            if(timelineId != null) {
                var timeline = await fetch(ghHostApiUrl + "/" + owner + "/" + repo + "/_apis/v1/Timeline/" + timelineId, { });
                if(timeline.status === 200) {
                    var newTimeline = await timeline.json() as ITimeLine[];
                    if(newTimeline != null && newTimeline.length > 1) {
                        setTitle(newTimeline.shift().name);
                        setTimeline(newTimeline);
                    } else {
                        setTitle("Unknown");
                        setTimeline([]);
                    }
                } else {
                    setTitle((query.job.errors !== null && query.job.errors.length > 0) ? "Failed to run" : "Wait for workflow to run...");
                    setTimeline(e => []);
                }
            }
            if(query.job.runid !== -1) {
                var artifacts = await listArtifacts(query.job.runid);
                if(artifacts.value !== undefined) {
                    for (let i = 0; i < artifacts.count; i++) {
                        const element = artifacts.value[i];
                        var items = await getContainerItems(element.name, element.fileContainerResourceUrl)
                        if(items !== undefined) {
                            element.files = items.value 
                        }
                    }
                    setArtifacts(_ => artifacts.value);
                }
            }
        })();
    }, [id, jobs, owner, repo])
    useEffect(() => {
        if(id !== undefined && id !== null && id.length > 0) {
            var item = getJobById(jobs, id).item;
            if(item !== null && item.description && item.description != '' && item.description != "00000000-0000-0000-0000-000000000000") {
                var source = new EventSource(ghHostApiUrl + "/" + owner + "/" + repo + "/_apis/v1/TimeLineWebConsoleLog?timelineId="+ item.description);
                try {
                    var missed : ILoglineEvent[] = [];
                    var callback = function(timeline, e:ILoglineEvent) {
                        var s = timeline.find(t => t.id === e.record.stepId);
                        var convert = new Convert({
                            newline: true,
                            escapeXML: true
                        });
                        if(s != null && s != undefined) {
                            if(s.log == null) {
                                s.log = { id:-1, location: null, content: ""};
                                if(e.record.startLine > 1) {
                                    (async () => {
                                        console.log("Downloading previous log lines of this step...");
                                        var lines = await fetch(ghHostApiUrl + "/" + owner + "/" + repo + "/_apis/v1/TimeLineWebConsoleLog/" + item.description + "/" + e.record.stepId, { });
                                        if(lines.status === 200) {
                                            var missingLines = await lines.json() as ILogline[];
                                            missingLines.length = e.record.startLine - 1;
                                            s.log.content = missingLines.reduce((prev: string, c : ILogline) => (prev.length > 0 ? prev + "<br/>" : "") + convert.toHtml(c.line), "") + s.log.content;
                                        } else {
                                            console.log("No logs to download..., currently fixes itself");
                                        }
                                    })();
                                }
                            }
                            if (s.log.id === -1) {
                                s.log.content = e.record.value.reduce((prev: string, c : string) => (prev.length > 0 ? prev + "<br/>" : "") + convert.toHtml(c), s.log.content);
                            }
                            return true;
                        }
                        return false;
                    }
                    source.addEventListener ("log", (ev : MessageEvent) => {
                        console.log("new logline " + ev.data);
                        var e = JSON.parse(ev.data) as ILoglineEvent;
                        setTimeline(timeline => {
                            if(callback(timeline, e)) {
                                return [...timeline];
                            }
                            missed.push(e);
                            return timeline;
                        });
                    });
                    source.addEventListener ("timeline", (ev : MessageEvent) => {
                        var e = JSON.parse(ev.data) as ITimeLineEvent;
                        setTitle(e.timeline.shift().name);
                        setTimeline(oldtimeline => {
                            var del = e.timeline.splice(0, oldtimeline.length)
                            for (let i = 0; i < del.length; i++) {
                                oldtimeline[i].result = del[i].result;
                                oldtimeline[i].state = del[i].state;
                            }
                            if(e.timeline.length === 0) {
                                // Todo Merge Timelines here
                                return oldtimeline;
                            }
                            var timeline = [...oldtimeline, ...e.timeline]
                            for (; missed.length > 0;) {
                                if(callback(timeline, missed[0])) {
                                    missed.shift();
                                } else {
                                    break;
                                }
                            }
                            return timeline;
                        });
                        // console.log(ev.data)
                    });
                } finally {
                    return () => {
                        source.close();
                    }
                }
            }
        }
        return () => {}
    }, [id, jobs, owner, repo]);

    return (
        <section className={styles.component}>
        <Header title={title} />
        <main className={styles.main}>
            <div className={styles.text} style={{width: '100%'}}>
                {(() => {
                    var job = getJobById(jobs, id);
                    if(job !== undefined && job.job != null) {
                        return  <button onClick={(event) => {
                            (async () => {
                                await fetch(ghHostApiUrl + "/" + owner + "/" + repo + "/_apis/v1/Message/cancel/" + job.job.jobId, { method: "POST" });
                            })();
                        }}>Cancel</button>;
                    }
                    return <div>This Job was cancelled</div>;
                })()
                }
                
                {errors.map(e => <div>Error: {e}</div>)}
                {artifacts.map((container: ArtifactResponse) => <div><div>{container.name}</div>{(() => {
                    if(container.files !== undefined) {
                        return container.files.map(file => <div><a href={file.contentLocation}>{file.path}</a></div>);
                    }
                    return <div/>;
                })()}</div>)}
                {timeline.map((item: ITimeLine) =>
                    <Collapsible key={id + item.id} className={styles.Collapsible} openedClassName={styles.Collapsible} triggerClassName={styles.Collapsible__trigger} triggerOpenedClassName={styles.Collapsible__trigger + " " + styles["is-open"]} contentOuterClassName={styles.Collapsible__contentOuter} contentInnerClassName={styles.Collapsible__contentInner} trigger={(item.result == null ? item.state == null ? "Waiting" : item.state  : item.result) + " - " + item.name} onOpening={() => {
                        if(!item.busy && (item.log == null || (item.log.id !== -1 && (!item.log.content || item.log.content.length === 0)))) {
                            item.busy = true;
                            (async() => {
                                try {
                                    var convert = new Convert({
                                        newline: true,
                                        escapeXML: true
                                    });
                                    if(item.log == null) {
                                        console.log("Downloading previous log lines of this step...");
                                        const item2 = getJobById(jobs, id).item;
                                        var logs = await fetch(ghHostApiUrl + "/" + owner + "/" + repo + "/_apis/v1/TimeLineWebConsoleLog/" + item2.description + "/" + item.id, { });
                                        if(logs.status === 200) {
                                            var missingLines = await logs.json() as ILogline[];
                                            item.log = { id: -1, location: null, content: missingLines.reduce((prev: string, c : ILogline) => (prev.length > 0 ? prev + "<br/>" : "") + convert.toHtml(c.line), "") };
                                        } else {
                                            console.log("No logs to download...");
                                        }
                                    } else {
                                        const log = await (await fetch(ghHostApiUrl + "/" + owner + "/" + repo + "/_apis/v1/Logfiles/" + item.log.id, { })).text();
                                        var lines = log.split('\n');
                                        var offset = '2021-04-02T15:50:14.6619714Z '.length;
                                        var re = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}.[0-9]{7}Z /;
                                        lines[0] = convert.toHtml(re.test(lines[0]) ? lines[0].substring(offset) : lines[0]);
                                        item.log.content = lines.reduce((prev, currentValue) => (prev.length > 0 ? prev + "<br/>" : "") + convert.toHtml(re.test(currentValue) ? currentValue.substring(offset) : currentValue));
                                    }
                                } finally {
                                    item.busy = false;
                                    // that.forceUpdate();
                                    setTimeline((t) => {
                                        return [...t];
                                    });
                                }
                            })();
                        }
                    }}>
                        <div style={{ textAlign: 'left', whiteSpace: 'nowrap', maxHeight: '100%', overflow: 'auto', fontFamily: "SFMono-Regular,Consolas,Liberation Mono,Menlo,monospace" }} dangerouslySetInnerHTML={{ __html: item.log != null ? item.log.content : "Nothing here" }}></div>
                    </Collapsible>
                )}
            </div>
        </main>
        </section>
    );
};