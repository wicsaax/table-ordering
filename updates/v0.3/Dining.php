<?php
namespace app\dining\service;
use PDO;
use DomainException;
/** Single-store extension. Uses upstream jjjfood product/SKU/table/order tables. */
class Dining {
 private PDO $db;
 private array $config;
 public function __construct(?PDO $db=null, ?array $config=null) {
  $this->config=$config ?? require dirname(__DIR__,3).'/dining-config.php';
  $this->db=$db ?? new PDO($this->config['dsn'],$this->config['db_user'],$this->config['db_password'],[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_EMULATE_PREPARES=>false]);
  if(PHP_SAPI!=='cli' && session_status()!==PHP_SESSION_ACTIVE){
   session_name('dining_staff');
   $sessionDir=dirname(__DIR__,3).'/runtime/dining-sessions';
   if(!is_dir($sessionDir)&&!mkdir($sessionDir,0700,true)&&!is_dir($sessionDir))throw new \RuntimeException('Cannot create session directory');
   session_save_path($sessionDir);
   ini_set('session.gc_maxlifetime','2592000');
   ini_set('session.use_strict_mode','1');
   session_set_cookie_params(['lifetime'=>2592000,'httponly'=>true,'samesite'=>'Strict','secure'=>!empty($_SERVER['HTTPS'])&&$_SERVER['HTTPS']!=='off','path'=>'/']);
   session_start();
  }
 }
 private function q(string $sql,array $params=[]): \PDOStatement {$s=$this->db->prepare($sql);$s->execute($params);return $s;}
 private function one(string $sql,array $params=[]):?array {return $this->q($sql,$params)->fetch(PDO::FETCH_ASSOC)?:null;}
 private function all(string $sql,array $params=[]):array {return $this->q($sql,$params)->fetchAll(PDO::FETCH_ASSOC);}
 private function check(bool $ok,string $msg):void {if(!$ok)throw new DomainException($msg);}
 private function txn(callable $fn):mixed {$this->db->beginTransaction();try{$r=$fn();$this->db->commit();return $r;}catch(\Throwable $e){$this->db->rollBack();throw $e;}}
 private function staff(bool $write=false):void {
  $this->check(($_SESSION['staff_until']??0)>time(),'请先登录店员账号');
  if($write)$this->check(isset($_SERVER['HTTP_X_CSRF_TOKEN'])&&hash_equals($_SESSION['csrf']??'',$_SERVER['HTTP_X_CSRF_TOKEN']),'登录验证失效，请重新登录');
 }
 private function table(string $token,bool $lock=false):array {
  $this->check((bool)preg_match('/^[a-f0-9]{48}$/',$token),'桌码无效');
  $r=$this->one('SELECT d.*,t.table_no FROM dining_table d JOIN jjjfood_table t ON t.table_id=d.table_id WHERE d.token=?'.($lock?' FOR UPDATE':''),[$token]);
  $this->check((bool)$r,'桌码不存在');return $r;
 }
 public function handle(string $action,array $d=[],array $get=[]):array {
  if($action==='login'){
   $ip=$_SERVER['REMOTE_ADDR']??'local';$key=hash('sha256',$ip);
   return $this->txn(function()use($d,$key){
    $this->q('INSERT IGNORE INTO dining_login_limit (id,attempts,until_at) VALUES (?,0,0)',[$key]);
    $limit=$this->one('SELECT * FROM dining_login_limit WHERE id=? FOR UPDATE',[$key]);
    $this->check(!($limit['attempts']>=10&&$limit['until_at']>time()),'尝试过多，请 15 分钟后重试');
    if(!password_verify((string)($d['password']??''),$this->config['staff_password_hash'])){
     $n=$limit['until_at']>time()?(int)$limit['attempts']+1:1;
     $this->q('UPDATE dining_login_limit SET attempts=?,until_at=? WHERE id=?',[$n,time()+900,$key]);
     return ['error'=>'密码错误'];
    }
    $this->q('DELETE FROM dining_login_limit WHERE id=?',[$key]);
    if(PHP_SAPI!=='cli')session_regenerate_id(true);
    $_SESSION['staff_until']=time()+2592000;$_SESSION['csrf']=bin2hex(random_bytes(24));
    return ['csrf'=>$_SESSION['csrf']];
   });
  }
  if($action==='who'){ $this->staff();return ['csrf'=>$_SESSION['csrf'],'name'=>$this->config['shop_name']];}
  if($action==='logout'){$this->staff(true);$_SESSION=[];return ['ok'=>true];}
  if($action==='menu'){
   $t=$this->table((string)($get['table']??''));
   return ['name'=>$this->config['shop_name'],'table_no'=>$t['table_no'],'session_id'=>$t['session_id'],'items'=>$this->catalog(false)];
  }
  if($action==='orders'){
   $t=$this->table((string)($get['table']??''));$sid=(string)($get['session_id']??'');
   $this->check($sid!==''&&$t['session_id']===$sid,'本次用餐已结束，请重新扫码');
   return ['orders'=>$this->orders($sid)];
  }
  if($action==='join')return $this->openTable((string)($d['table']??''));
  if($action==='submit')return $this->submit($d);
  $write=!in_array($action,['board','tables','catalog','codes'],true);$this->staff($write);
  if($action==='board')return ['orders'=>$this->orders(null),'time'=>time()];
  if($action==='tables')return ['tables'=>$this->all('SELECT d.*,t.table_no FROM dining_table d JOIN jjjfood_table t ON t.table_id=d.table_id ORDER BY t.table_id')];
  if($action==='codes'){
   $tables=$this->all('SELECT d.token,t.table_no FROM dining_table d JOIN jjjfood_table t ON t.table_id=d.table_id ORDER BY t.table_id');
   foreach($tables as &$t){$t['url']=rtrim($this->config['base_url'],'/').'/dining/?table='.$t['token'];$t['qr']=(new \Endroid\QrCode\Writer\SvgWriter())->write(new \Endroid\QrCode\QrCode($t['url']))->getDataUri();}
   return ['tables'=>$tables];
  }
  if($action==='catalog')return ['items'=>$this->catalog(true)];
  if($action==='open')return $this->openTable((string)($d['table']??''));
  if($action==='state')return $this->txn(function()use($d){
   $id=filter_var($d['order_id']??null,FILTER_VALIDATE_INT);$target=$d['state']??'';
   // Lock the same table row as settlement to serialize undo/clear races.
   $ref=$this->one('SELECT s.table_id FROM dining_order d JOIN dining_session s ON s.id=d.session_id WHERE d.order_id=?',[$id]);
   $this->check((bool)$ref,'订单不存在');
   $this->one('SELECT table_id FROM dining_table WHERE table_id=? FOR UPDATE',[$ref['table_id']]);
   $o=$this->one('SELECT * FROM dining_order WHERE order_id=? FOR UPDATE',[$id]);
   $this->check((bool)$o,'订单不存在');
   if($o['state']===$target)return ['ok'=>true];
   $next=['new'=>['accepted','ready'],'accepted'=>['ready'],'ready'=>['accepted']];
   $this->check(in_array($target,$next[$o['state']]??[],true),'订单状态已变化，请刷新');
   $this->q('UPDATE dining_order SET state=? WHERE order_id=?',[$target,$id]);
   $this->q('INSERT INTO dining_audit (order_id,action,created_at) VALUES (?,?,?)',[$id,$target,time()]);
   if($target==='ready')$this->q('UPDATE jjjfood_order SET delivery_status=20,delivery_time=?,update_time=? WHERE order_id=?',[time(),time(),$id]);
   if($o['state']==='ready'&&$target==='accepted')$this->q('UPDATE jjjfood_order SET delivery_status=10,delivery_time=0,update_time=? WHERE order_id=?',[time(),$id]);
   return ['ok'=>true];
  });
  if($action==='close')return $this->txn(function()use($d){
   $t=$this->table((string)($d['table']??''),true);$sid=(string)($d['session_id']??'');
   $this->check($sid!==''&&$sid===$t['session_id'],'桌台已变化，请刷新');
   $pending=$this->one("SELECT COUNT(*) AS n FROM dining_order WHERE session_id=? AND state NOT IN ('ready','settled')",[$sid]);
   $this->check((int)$pending['n']===0,'还有未出餐订单，请先处理');
   $sum=$this->one('SELECT COALESCE(SUM(o.pay_price),0) total FROM jjjfood_order o JOIN dining_order d ON d.order_id=o.order_id WHERE d.session_id=?',[$sid]);
   $this->check(isset($d['expected_total'])&&(string)$d['expected_total']===(string)$sum['total'],'账单已变化，请刷新后重新核对金额');
   $this->q("UPDATE dining_order SET state='settled' WHERE session_id=?",[$sid]);
   $this->q('UPDATE jjjfood_order o JOIN dining_order d ON o.order_id=d.order_id SET o.order_status=30,o.pay_status=20,o.pay_type=40,o.pay_time=?,o.receipt_status=20,o.receipt_time=?,o.update_time=? WHERE d.session_id=?',[time(),time(),time(),$sid]);
   $this->q('UPDATE dining_session SET closed_at=? WHERE id=?',[time(),$sid]);
   $this->q('UPDATE dining_table SET session_id=NULL WHERE table_id=?',[$t['table_id']]);
   $this->q('INSERT INTO dining_audit (order_id,action,created_at) VALUES (0,?,?)',['settle:'.$sid,time()]);
   return ['ok'=>true,'total'=>$sum['total']];
  });
  if($action==='product_setup')return $this->txn(function()use($d){
   $id=filter_var($d['product_id']??null,FILTER_VALIDATE_INT);
   $p=$this->one('SELECT * FROM jjjfood_product WHERE product_id=? AND app_id=10001 AND shop_supplier_id=10001 FOR UPDATE',[$id]);
   $this->check((bool)$p,'菜品不存在');
   $name=trim((string)($d['name']??''));$this->check(mb_strlen($name)>0&&mb_strlen($name)<=50,'菜名需为1至50字');
   $variants=$d['variants']??[];$this->check(is_array($variants)&&count($variants)>0&&count($variants)<=12,'每道菜需有1至12个规格');
   $existing=$this->all('SELECT * FROM jjjfood_product_sku WHERE product_id=? ORDER BY product_sku_id FOR UPDATE',[$id]);
   $by=[];foreach($existing as $v)$by[(int)$v['product_sku_id']]=$v;
   $defaultIndex=$d['default_index']??0;$this->check(is_int($defaultIndex)&&isset($variants[$defaultIndex]),'默认份量无效');
   $allowed=['spice'=>['default','none','mild','medium','hot'],'salt'=>['default','less'],'cilantro'=>['default','none'],'scallion'=>['default','none']];
   $taste=[];
   foreach($allowed as $key=>$values){
    $c=$d['tastes'][$key]??['enabled'=>true,'values'=>$values,'default'=>'default'];
    $this->check(is_array($c)&&is_bool($c['enabled']??null)&&is_array($c['values']??null),'口味配置无效');
    $this->check(in_array('default',$c['values'],true)&&!array_diff($c['values'],$values)&&in_array($c['default']??null,$c['values'],true),'默认口味必须在已勾选选项中');
    $taste[$key]=['enabled'=>$c['enabled'],'values'=>array_values(array_unique($c['values'])),'default'=>$c['enabled']?$c['default']:'default'];
   }
   $ids=[];$names=[];$seen=[];
   foreach($variants as $v){
    $vid=$v['id']??0;$this->check(is_int($vid)&&$vid>=0,'规格编号无效');
    $title=trim((string)($v['name']??''));$this->check(mb_strlen($title)>0&&mb_strlen($title)<=30&&!in_array($title,$names,true),'规格名称不能为空或重复');$names[]=$title;
    $this->check(is_string($v['price']??null)&&preg_match('/^\d{1,4}(\.\d{1,2})?$/',$v['price'])===1,'价格需为0至9999.99元');
    $this->check(is_bool($v['available']??null),'可售状态无效');
    if($vid){
     $this->check(isset($by[$vid])&&!isset($seen[$vid]),'规格不属于该菜品或重复');$seen[$vid]=true;
     $stock=$v['available']?max(1,(int)$by[$vid]['stock_num']):0;if($v['available']&&(int)$by[$vid]['stock_num']===0)$stock=9999;
     $this->q('UPDATE jjjfood_product_sku SET spec_name=?,product_price=?,stock_num=?,update_time=? WHERE product_sku_id=?',[$title,$v['price'],$stock,time(),$vid]);
    }else{
     $this->q('INSERT INTO jjjfood_product_sku (product_id,spec_name,product_price,stock_num,app_id,create_time,update_time) VALUES (?,?,?,?,10001,?,?)',[$id,$title,$v['price'],$v['available']?9999:0,time(),time()]);$vid=(int)$this->db->lastInsertId();
    }$ids[]=$vid;
   }
   $this->check(count($seen)===count($by),'请保留已有规格，不售卖的规格取消可售即可');
   $attrs=json_decode($p['product_attr']?:'{}',true);if(!is_array($attrs))$attrs=[];
   $attrs['dining']=['default_size'=>$ids[$defaultIndex],'tastes'=>$taste];
   $this->q('UPDATE jjjfood_product SET product_name=?,product_attr=?,spec_type=?,update_time=? WHERE product_id=?',[$name,json_encode($attrs,JSON_UNESCAPED_UNICODE),count($ids)>1?20:10,time(),$id]);
   $this->q('INSERT INTO dining_audit(order_id,action,created_at) VALUES(0,?,?)',['product_setup:'.$id,time()]);
   return ['ok'=>true];
  });
  if($action==='product')return $this->txn(function()use($d){
   $id=filter_var($d['sku_id']??null,FILTER_VALIDATE_INT);
   $this->check(is_string($d['price']??null)&&preg_match('/^\d{1,4}(\.\d{1,2})?$/',$d['price'])===1,'价格应为 0 至 9999.99 元');
   $this->check(in_array($d['available']??null,[true,false],true),'售卖状态无效');
   $s=$this->one('SELECT * FROM jjjfood_product_sku WHERE product_sku_id=? FOR UPDATE',[$id]);$this->check((bool)$s,'菜品不存在');
   $this->q('UPDATE jjjfood_product_sku SET product_price=?,stock_num=?,update_time=? WHERE product_sku_id=?',[$d['price'],$d['available']?9999:0,time(),$id]);
   $this->q('INSERT INTO dining_audit (order_id,action,created_at) VALUES (0,?,?)',['sku:'.$id.':'.$d['price'].':'.($d['available']?'on':'off'),time()]);
   return ['ok'=>true];
  });
  throw new DomainException('操作不存在');
 }
 private function openTable(string $token):array {
  return $this->txn(function()use($token){
   $t=$this->table($token,true);
   if($t['session_id'])return ['session_id'=>$t['session_id']];
   $sid=bin2hex(random_bytes(16));
   $this->q('INSERT INTO dining_session (id,table_id,opened_at) VALUES (?,?,?)',[$sid,$t['table_id'],time()]);
   $this->q('UPDATE dining_table SET session_id=? WHERE table_id=?',[$sid,$t['table_id']]);
   return ['session_id'=>$sid];
  });
 }
 private function catalog(bool $all):array {
  return $this->all('SELECT s.product_sku_id AS id,p.product_id,p.product_name AS name,s.spec_name AS size,s.product_price AS price,s.stock_num,c.name AS category,p.selling_point AS note,p.product_attr AS choice_config FROM jjjfood_product_sku s JOIN jjjfood_product p ON p.product_id=s.product_id JOIN jjjfood_category c ON c.category_id=p.category_id WHERE p.app_id=10001 AND p.shop_supplier_id=10001 AND p.is_delete=0 AND p.product_type=1'.($all?'':' AND p.product_status=10').' ORDER BY c.sort,p.product_sort,p.product_id,s.product_sku_id');
 }
 private function orders(?string $sid):array {
  $where=$sid!==null?'d.session_id=?':"s.closed_at IS NULL";
  $rows=$this->all('SELECT o.order_id,o.order_no,o.table_no,o.table_id,o.buyer_remark,o.pay_price,o.create_time,d.state,d.session_id FROM dining_order d JOIN jjjfood_order o ON o.order_id=d.order_id JOIN dining_session s ON s.id=d.session_id WHERE '.$where.' ORDER BY o.order_id', $sid!==null?[$sid]:[]);
  if(!$rows)return [];
  $ids=array_column($rows,'order_id');$marks=implode(',',array_fill(0,count($ids),'?'));
  $items=$this->all("SELECT order_id,product_name,product_attr,total_num,product_price FROM jjjfood_order_product WHERE order_id IN ($marks)",$ids);
  $by=[];foreach($items as $item)$by[$item['order_id']][]=$item;
  $batches=[];
  foreach($rows as &$row){$row['items']=$by[$row['order_id']]??[];$row['batch']=($batches[$row['session_id']]??0)+1;$batches[$row['session_id']]=$row['batch'];}
  return $rows;
 }
 private function submit(array $d):array {
  $this->check(is_array($d['items']??null)&&count($d['items'])>0&&count($d['items'])<=80,'请选择 1 至 80 项菜品');
  $this->check(is_string($d['request_id']??null)&&preg_match('/^[a-zA-Z0-9-]{16,64}$/',$d['request_id'])===1,'请求编号无效');
  $this->check(is_string($d['note']??'')&&mb_strlen($d['note']??'')<=200,'备注最多 200 字');
  $normalized=[];$required=[];
  $allowed=['spice'=>['default','none','mild','medium','hot'],'salt'=>['default','less'],'cilantro'=>['default','none'],'scallion'=>['default','none']];
  foreach($d['items'] as $i){
   $this->check(is_array($i)&&is_int($i['id']??null)&&is_int($i['qty']??null)&&$i['qty']>0&&$i['qty']<=50,'菜品数量无效');
   $opts=$i['options']??[];$this->check(is_array($opts),'口味选项无效');
   $this->check(!array_diff(array_keys($opts),array_keys($allowed)),'口味选项无效');
   $values=[];foreach($allowed as $name=>$choices){$v=$opts[$name]??'default';$this->check(in_array($v,$choices,true),'口味选项无效');$values[]=$v;}
   $key=(string)$i['id'];if(count(array_filter($values,fn($v)=>$v!=='default')))$key.='~'.implode('~',$values);
   $normalized[$key]=($normalized[$key]??0)+$i['qty'];
   $required[$i['id']]=($required[$i['id']]??0)+$i['qty'];
   $this->check($required[$i['id']]<=50,'单种菜品最多 50 份');
  }ksort($normalized);
  $hash=hash('sha256',json_encode([$normalized,$d['note']??''],JSON_UNESCAPED_UNICODE));
  return $this->txn(function()use($d,$normalized,$required,$hash){
   $t=$this->table((string)($d['table']??''),true);$sid=(string)($d['session_id']??'');
   $old=$this->one('SELECT d.*,s.table_id FROM dining_order d JOIN dining_session s ON s.id=d.session_id WHERE d.session_id=? AND d.request_id=?',[$sid,$d['request_id']]);
   if($old){$this->check((int)$old['table_id']===(int)$t['table_id']&&hash_equals($old['payload_hash'],$hash),'请求已使用且内容不同');return ['order_id'=>$old['order_id'],'duplicate'=>true];}
   $this->check($sid!==''&&$t['session_id']===$sid,'本次用餐已结束或尚未开桌，请联系店员');
   $lines=[];$total=0;
   foreach($normalized as $key=>$qty){
    $parts=explode('~',(string)$key);$id=(int)$parts[0];
    $descriptions=['none'=>['不辣','少盐','不要香菜','不要葱'],'mild'=>['微辣'],'medium'=>['中辣'],'hot'=>['特辣'],'less'=>[1=>'少盐']];
    $taste=[];foreach(array_slice($parts,1) as $j=>$v){if($v!=='default')$taste[]=$descriptions[$v][$j];}
    $s=$this->one('SELECT s.*,p.product_name,p.product_status,p.is_delete,p.app_id,p.shop_supplier_id,p.product_attr AS choice_config FROM jjjfood_product_sku s JOIN jjjfood_product p ON p.product_id=s.product_id WHERE s.product_sku_id=? FOR UPDATE',[$id]);
    $this->check($s&&(int)$s['app_id']===10001&&(int)$s['shop_supplier_id']===10001&&(int)$s['product_status']===10&&!(int)$s['is_delete'],'菜品已下架，请重新选择');
    $config=json_decode($s['choice_config']?:'{}',true)['dining']['tastes']??[];
    foreach(['spice','salt','cilantro','scallion'] as $j=>$kind){$value=$parts[$j+1]??'default';$rule=$config[$kind]??null;if(is_array($rule))$this->check($value==='default'||(($rule['enabled']??true)&&in_array($value,$rule['values']??[],true)),'菜品口味选项已更新，请重新选择');}
    $this->check((int)$s['stock_num']>=$required[$id],$s['product_name'].'已售罄或库存不足');
    $cents=(int)round((float)$s['product_price']*100);$total+=$cents*$qty;$s['qty']=$qty;$s['cents']=$cents;$s['order_attr']=$s['spec_name'].($taste?' · '.implode('、',$taste):'');$lines[]=$s;
   }
   $this->check($total<=99999999,'订单金额过大');
   $price=number_format($total/100,2,'.','');$now=time();
   $no=date('ymdHis').bin2hex(random_bytes(4));
   $this->q('INSERT INTO jjjfood_order (order_no,total_price,order_price,pay_price,buyer_remark,pay_type,pay_source,pay_status,delivery_type,order_source,shop_supplier_id,order_type,table_no,table_id,app_id,create_time,update_time) VALUES (?,?,?,?,?,40,\'dining\',10,40,30,10001,1,?,?,10001,?,?)',[$no,$price,$price,$price,$d['note']??'',$t['table_no'],$t['table_id'],$now,$now]);
   $oid=(int)$this->db->lastInsertId();
   foreach($lines as $s){
    $line=number_format($s['cents']*$s['qty']/100,2,'.','');
    $this->q('INSERT INTO jjjfood_order_product (product_id,product_name,product_sku_id,product_attr,content,product_price,total_num,total_price,total_pay_price,order_id,app_id,create_time,deduct_stock_type) VALUES (?,?,?,?,\'\',?,?,?,?,?,10001,?,10)',[$s['product_id'],$s['product_name'],$s['product_sku_id'],$s['order_attr'],$s['product_price'],$s['qty'],$line,$line,$oid,$now]);
    $this->q('UPDATE jjjfood_product_sku SET stock_num=stock_num-? WHERE product_sku_id=?',[$s['qty'],$s['product_sku_id']]);
   }
   $this->q('INSERT INTO dining_order (order_id,session_id,request_id,payload_hash,state) VALUES (?,?,?,?,\'new\')',[$oid,$sid,$d['request_id'],$hash]);
   return ['order_id'=>$oid,'total'=>$price];
  });
 }
}
