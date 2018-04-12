var model_org = require("../models/user_model");
var process_model = require("../models/process_model");
var Promise = require("bluebird");
var utils = require('../../../../lib/utils/app_utils');

var mysql_pool_promise = require("../../../../lib/mysql_pool_athena");
var fs = require('fs');
var ObjectID = require('mongodb').ObjectID;
var config = require('../../../../config');

var peson_sync_data_from_Athena_url = config.peson_sync_data_from_Athena_url;

exports.sync_data_from_Athena = function () {
    sync_data_from_Athena();
}

update_data();

function sync_data_from_Athena() {
    update_data();
}

/**
 *  从雅典娜更新人员数据
 * @returns {bluebird|exports|module.exports}   hall_manager_info
 */
function update_data() {
    return new Promise(async (resolve, reject) => {
        let sql = 'select  ' +
            '    a.work_id, ' +
            'a.phone, ' +
            'a. NAME, ' +
            'group_concat(a.orgIds) orgIds, ' +
            'group_concat(a.roleIds) roleIds ' +
            'FROM ' +
            '( ' +
            'SELECT ' +
            't1.work_id, ' +
            't1.phone, ' +
            't1. NAME, ' +
            'group_concat(t1.orgId) orgIds, ' +
            'group_concat(t1.roleId) roleIds ' +
            'FROM ' +
            '( ' +
            'SELECT ' +
            'TRIM(t.salesperson_tel) phone, ' +
            't.salesperson_name NAME, ' +
            't.salesperson_id work_id, ' +
            't.channel_id orgId, ' +
            '\'5a26418c5eb3fe1068448753\' roleId, ' +
            '\'\' count ' +
            'FROM ' +
            'salesperson_info t ' +
            'UNION ALL ' +
            'SELECT ' +
            'TRIM(t.hall_manager_tel) phone, ' +
            't.hall_manager_name NAME, ' +
            'TRIM(t.hall_manager_tel) work_id, ' +
            't.channel_id orgId, ' +
            '\'5a266868bfb42d1e9cdd5c6e\' roleId, ' +
            '\'\' count ' +
            'FROM ' +
            'hall_manager_info t ' +
            'UNION ALL ' +
            'SELECT ' +
            'TRIM(t.grid_manager_tel) phone, ' +
            't.grid_manager_name NAME, ' +
            'grid_manager_id work_id, ' +
            't.grid_coding orgId, ' +
            '\'5a264057c819ed211853907a\' roleId, ' +
            'max(count) ' +
            'FROM ' +
            '( ' +
            'SELECT ' +
            '*, count(1) count ' +
            'FROM ' +
            'grid_manager_info ' +
            'WHERE ' +
            'grid_coding IS NOT NULL ' +
            'GROUP BY ' +
            'grid_coding, ' +
            'grid_manager_tel ' +
            ') t ' +
            'GROUP BY ' +
            'grid_coding ' +
            ') t1 ' +
            'WHERE ' +
            't1.phone IS NOT NULL ' +
            'AND t1.`NAME` IS NOT NULL ' +
            'AND ( ' +
            'LENGTH(t1.phone) = 12 ' +
            'OR LENGTH(t1.phone) = 11 ' +
            ') ' +
            'AND t1.work_id IS NOT NULL ' +
            'AND LENGTH(t1.work_id) >= 8 ' +
            'AND t1.orgId IS NOT NULL ' +
            'AND t1.orgId != \'\' ' +
            'GROUP BY ' +
            't1.phone ' +
            ') a ' +
            '  GROUP BY   a.work_id  ';
        let condition = {};
        console.log(sql);
        let result = await mysql_pool_promise.queryPromise(sql, condition);
        if (!result) {
            console.log("获取mysql人员总数失败");
        } else {
           console.log(result.length);
            await savePeason(result);
            console.log("获取mysql人员总数成功");
        }
    });
}

/**
 * 保存或修改人员
 * @param result
 * @param type 1厅经理  2营业员  3网格经理
 */
function savePeason(result) {
    return new Promise(async (resolve, reject) => {
        let count = 0;
        /**
         *,因为同步的账号信息可能会被人工增加其他角色，
         * 这里获取网格经理，厅经理，营业员的角色，如果修改的人员的角色有除了这三种角色外的角色，则保留那个角色
         */
        let roles = ['5a26418c5eb3fe1068448753', '5a266868bfb42d1e9cdd5c6e', '5a264057c819ed211853907a'];
        /**
         *,因为同步的账号信息可能会被人工增加其他机构，
         * 这里获取除了网格，渠道之外的组织是为了判断修改的账号的组织是否存在之外的组织,
         * 如果存在则保留，只修改用户渠道和网格组织
         */
        let core_org = await model_org.$CommonCoreOrg.find({"level": {$nin: [5, 6]}});
        let core_org_id = [];
        for (let i = 0; i < core_org.length; i++) {
            core_org_id.push((core_org[i]._id).toString());
        }
        for (let i in result) {
            let inst = {};
            let user_org = new Set();
            let sys_roles = new Set();
            let orgIds = result[i].orgIds.split(",");
            let roleIds = result[i].roleIds.split(",");
            //查找人员信息
            model_org.$User.find({"user_no":result[i].work_id}, function (err, resp) {

                model_org.$CommonCoreOrg.find({"company_code": {$in: orgIds}}, function (err, res) {
                    for (let k = 0; k < res.length; k++) {
                        user_org.add(res[k]._id);
                    }

                    //遍历角色
                    for (let k = 0; k < roleIds.length; k++) {
                        sys_roles.add(roleIds[k]);
                    }

                    //用户存在则修改
                    if (resp.length == 1) {
                        let user_roles_local = resp[0].user_roles;
                        let user_org_local = resp[0].user_org;

                        //判断是否存在需要保留的角色
                        for (let j =0;j< user_roles_local.length;j++) {
                            //表示此角色不为同步的三种角色，保留
                            if (roles.indexOf(user_roles_local[j].toString()) == -1) {
                                sys_roles.add(user_roles_local[j]);
                            }
                        }

                        //判断是否存在需要保留的组织
                        for (let j =0;j< user_org_local.length;j++) {
                            //表示此角色在渠道和网格之外，保留
                            if (core_org_id.indexOf(user_org_local[j].toString()) > -1) {
                                user_org.add(user_org_local[j]);
                            }
                        }


                        inst.user_roles =[...sys_roles] ;
                        inst.user_org = [...user_org];
                        //以前是手机号为user_no,后来发现手机号会变，但是工号不会
                        //这里用工号做唯一标识，厅经理和网格经理的还是用手机号
                        inst.user_no = result[i].work_id;
                        inst.work_id = result[i].work_id;
                        inst.user_name = result[i].NAME;
                        inst.login_account = result[i].phone;
                        inst.user_phone = result[i].phone;
                        inst.user_tel = result[i].phone;
                        model_org.$User.update({"_id": resp[0]._id},inst,function(err){
                            count++;
                            if (count == result.length) {
                                resolve();
                            }
                        })

                    } else if(resp.length >1 ){
                        model_org.$User.remove({"user_no":result[i].work_id},function(err){
                            // 实例模型，调用保存方法
                            new model_org.$User(inst).save(function (err) {
                                count++;
                                if (count == result.length) {
                                    resolve();
                                }
                            });
                        })
                    } else{



                        //获取角色
                        //console.log(3);
                        inst.login_account = result[i].phone;
                        inst.user_status = 1;
                        inst.user_id = "";
                        inst.work_id = result[i].work_id;
                        inst.user_no = result[i].work_id;
                        inst.user_name = result[i].NAME;
                        inst.user_gender = "";
                        inst.user_phone = result[i].phone;
                        inst.user_tel = result[i].phone;
                        inst.user_email = "";
                        var password = 'gdgl@cmcc';
                        inst.login_password = utils.encryptDataByMD5(password);
                        inst.user_sys = "56f20ec0c2b4db9c2a7dfe7a";
                        inst.user_org_desc = "";
                        inst.theme_name = "themes/beyond/";
                        inst.theme_skin = "deepblue";
                        inst.user_photo = "";
                        inst.smart_visual_sys_user_id = "";
                        inst.athena_sys_user_id = "";
                        inst.athena_app_sys_user_id = "";
                        inst.inspect_sys_user_id = "";
                        inst.token = "";
                        inst.special_sign = "";
                        inst.__v = 0;

                        model_org.$User.find({"work_id":result[i].work_id},function(err,res){

                            if(res.length == 1){
                                let user_no = res[0].user_no;
                                let user_roles_local = res[0].user_roles;
                                let user_org_local = res[0].user_org;
                                process_model.$ProcessInst.update({"proc_start_user":user_no},{$set:{"proc_start_user":result[i].work_id}},{multi: true}, function(err){
                                    process_model.$ProcessInstTask.update({"proc_inst_task_assignee":user_no},{$set:{"proc_inst_task_assignee":result[i].work_id}},{multi: true}, function(err){
                                        process_model.$ProcessTaskHistroy.update({"proc_inst_task_assignee":user_no},{$set:{"proc_inst_task_assignee":result[i].work_id}},{multi: true}, function(err){
                                            model_org.$User.remove({"_id":res[0]._id},function(err){

                                                //判断是否存在需要保留的角色
                                                for (let j =0;j< user_roles_local.length;j++) {
                                                    //表示此角色不为同步的三种角色，保留
                                                    if (roles.indexOf(user_roles_local[j].toString()) == -1) {
                                                        sys_roles.add(user_roles_local[j]);
                                                    }
                                                }

                                                //判断是否存在需要保留的组织
                                                for (let j =0;j< user_org_local.length;j++) {
                                                    //表示此角色在渠道和网格之外，保留
                                                    if (core_org_id.indexOf(user_org_local[j].toString()) > -1) {
                                                        user_org.add(user_org_local[j]);
                                                    }
                                                }
                                                inst.user_roles =[...sys_roles] ;
                                                inst.user_org = [...user_org];
                                                // 实例模型，调用保存方法
                                                new model_org.$User(inst).save(function (err) {
                                                    count++;
                                                    if (count == result.length) {
                                                        resolve();
                                                    }
                                                });
                                            })
                                        })
                                    })
                                })
                            }else if(res.length >1){
                                model_org.$User.remove({"user_no":result[i].work_id},function(err){
                                    // 实例模型，调用保存方法
                                    new model_org.$User(inst).save(function (err) {
                                        count++;
                                        if (count == result.length) {
                                            resolve();
                                        }
                                    });
                                })
                            }else{
                                model_org.$User.find({"login_account":result[i].phone},function(err,res){
                                    if(res.length == 1){
                                        let user_no = res[0].user_no;
                                        process_model.$ProcessInst.update({"proc_start_user":user_no},{$set:{"proc_start_user":result[i].work_id}},{multi: true}, function(err){
                                            process_model.$ProcessInstTask.update({"proc_inst_task_assignee":user_no},{$set:{"proc_inst_task_assignee":result[i].work_id}},{multi: true}, function(err){
                                                process_model.$ProcessTaskHistroy.update({"proc_inst_task_assignee":user_no},{$set:{"proc_inst_task_assignee":result[i].work_id}},{multi: true}, function(err){
                                                    model_org.$User.remove({"_id":res[0]._id},function(err){
                                                        // 实例模型，调用保存方法
                                                        new model_org.$User(inst).save(function (err) {
                                                            count++;
                                                            if (count == result.length) {
                                                                resolve();
                                                            }
                                                        });
                                                    })
                                                })
                                            })
                                        })
                                    }else{
                                        new model_org.$User(inst).save(function (err) {
                                            count++;
                                            if (count == result.length) {
                                                resolve();
                                            }
                                        });
                                    }
                                })

                            }
                        })
                    }
                });
            });

        }
        ;

    })

}

function writeFile(file, result) {
    fs.appendFile(file, '\r\n' + result, function (err) {
        if (err)
            console.log("fail " + err);
        else {
            console.log("写入文件ok");
            // fs.close();
        }
    })
}