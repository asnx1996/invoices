-- 014: طريقة عرض خلفية البورد
--   cover   = تملي الشاشة (ممكن ينگص من أطراف الصورة)
--   contain = الصورة كاملة بدون قص (والفراغ حواليها بلون الخلفية)
-- يتشغل بعد 013. آمن للتشغيل أكثر من مرة.
begin;

alter table public.boards add column if not exists bg_fit text not null default 'cover';
alter table public.boards drop constraint if exists boards_bg_fit_chk;
alter table public.boards add constraint boards_bg_fit_chk check (bg_fit in ('cover', 'contain'));

-- الصور المرفوعة صارت بدقة أعلى
alter table public.boards drop constraint if exists boards_bg_custom_chk;
alter table public.boards add constraint boards_bg_custom_chk check (
  bg_custom is null or (bg_custom ~ '^data:image/(jpeg|png|webp);base64,' and length(bg_custom) <= 4000000));

commit;

notify pgrst, 'reload schema';
