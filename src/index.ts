import {Plugin} from "siyuan";
import {icon} from "./icons";
import {renderDataStaging} from "./view";
import {StagingStorage} from "./storage";

const BLOCK_TYPE = "siyuan-data-staging";
const CUSTOM_BLOCK_MARKDOWN = `;;;siyuan-data-staging/siyuan-data-staging
{"version":1}
;;;`;

export default class DataStagingPlugin extends Plugin {
    public onload() {
        const storage = new StagingStorage(this.app.appId);
        this.customBlockRenders[BLOCK_TYPE] = {
            render: options => renderDataStaging(options, storage),
        };
        this.protyleSlash.push({
            id: BLOCK_TYPE,
            filter: ["数据暂存", "暂存", "文件暂存", "data staging", "file staging", "zc", "zj"],
            html: `<span class="data-staging-slash">${icon("box")}<span>数据暂存</span></span>`,
            callback: protyle => {
                protyle.insert(CUSTOM_BLOCK_MARKDOWN, true, true);
            },
        });
    }
}
