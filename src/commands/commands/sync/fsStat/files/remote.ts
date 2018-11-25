import { HostPrefixHandler } from "@common/src/hooks/hostPrefix";
import { HttpService } from "@common/src/services/http/http";
import * as path from "path";
import { parseString } from "xml2js";
import * as assert from "assert";
import matchesAnyGlob from './matchesAnyGlob';
import { FsStat } from '..';

interface Response {
  href: string;
  propstat: {
    prop:
      | {
          getcontentlength: string;
          md5sum: string;
        }
      | {};
  };
}

interface PropfindData {
  multistatus: {
    response: Response | Response[];
  };
}

function matchesAnySubpath(relPath: string, globs: string[]) {
  assert(relPath.startsWith("/"));
  let curRelPath = relPath;
  while (curRelPath) {
    if (matchesAnyGlob(curRelPath, globs)) {
      return true;
    }
    const lastSlashIndex = curRelPath.lastIndexOf("/");
    curRelPath = curRelPath.substr(0, lastSlashIndex);
  }
  return false;
}

export interface GetRemoteFilesOptions {
  httpService: HttpService;
  hostPrefixHandler: HostPrefixHandler;
  excludeGlobs: string[];
}

export default async function getRemoteFiles({
  httpService,
  hostPrefixHandler,
  excludeGlobs
}: GetRemoteFilesOptions) {
  const { requestPromise } = httpService.send({
    method: "PROPFIND",
    url: `${hostPrefixHandler.hostPrefix}/fs`,
    headers: {
      "Content-Type": "application/xml;charset=UTF-8",
      "lowrmt-md5": "1"
    }
  }); // todo error handling here too
  const { responseText, headers } = await requestPromise;
  const hadPut = headers['lowrmt-had-put']==='1';
  const result = await new Promise<PropfindData>((resolve, reject) => {
    parseString(responseText, { explicitArray: false }, (err, result) => {
      if (err) {
        return reject(err);
      }
      resolve(result);
    });
  });

  const stats: FsStat[] = [];
  let res = result.multistatus.response;
  res=Array.isArray(res)?res: [res]; 

  for (const resp of res) {
    let relPathPosix = resp.href.slice("/fs".length);
    if (relPathPosix === "/") continue;
    relPathPosix = decodeURIComponent(relPathPosix); // there were %20 in the string
    if (relPathPosix.endsWith("/")) relPathPosix = relPathPosix.slice(0, -1);
    if (matchesAnySubpath(relPathPosix, excludeGlobs)) continue;
    relPathPosix = relPathPosix.slice(1);
    const relPath = path.normalize(relPathPosix); // will now use path.sep
    const obj = resp.propstat.prop;
    if ("getcontentlength" in obj) {
      const size = parseInt(obj.getcontentlength);
      const md5 = obj.md5sum;
      stats.push({
        type: "file",
        relativePath: relPath,
        size,
        md5
      });
    } else {
      stats.push({
        type: "dir",
        relativePath: relPath
      });
    }
  }

  return { stats, hadPut  };
}