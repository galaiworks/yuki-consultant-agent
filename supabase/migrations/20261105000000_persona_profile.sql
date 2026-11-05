-- 判断軸に 6 層目「人格プロファイル」(経歴・転機・人間関係・性格・習慣)を足す
alter table public.persona_layers drop constraint if exists persona_layers_key_check;
alter table public.persona_layers add constraint persona_layers_key_check
  check (key in ('summary', 'values', 'reasoning', 'methods', 'boundaries', 'voice', 'profile'));
