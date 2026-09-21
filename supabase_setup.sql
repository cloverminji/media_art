-- ====================================================================
-- 🎨 MediaArt Live Sketch: Supabase Setup SQL Script
-- Supabase 대시보드(https://supabase.com)의 [SQL Editor]에 붙여넣고 [Run]을 누르세요.
-- ====================================================================

-- 1. 도안 (Templates) 테이블 생성
CREATE TABLE IF NOT EXISTS public.templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    icon TEXT DEFAULT '🎨',
    motion_type TEXT DEFAULT 'walk',
    image_url TEXT NOT NULL,
    skeleton JSONB,
    is_builtin BOOLEAN DEFAULT FALSE,
    created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
);

-- 2. 배경 테마 (Backgrounds) 테이블 생성
CREATE TABLE IF NOT EXISTS public.backgrounds (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    image_url TEXT NOT NULL,
    atmosphere TEXT DEFAULT 'sparkle',
    motion_type TEXT DEFAULT 'walk',
    created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
);

-- 3. 운영 환경설정 (App Config) 테이블 생성
CREATE TABLE IF NOT EXISTS public.app_config (
    id TEXT PRIMARY KEY DEFAULT 'default',
    config JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 기본 운영 환경설정 초기 데이터 (존재하지 않을 때만 삽입)
INSERT INTO public.app_config (id, config)
VALUES ('default', '{
  "theme": "ocean",
  "customBackgroundUrl": "",
  "themeName": "",
  "atmosphere": "ocean",
  "motionType": "walk",
  "lifetimeSeconds": 300,
  "maxCharacters": 35,
  "speedMultiplier": 1.0
}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- 4. RLS (Row Level Security) 설정
-- 미디어아트 시스템은 관리자/키오스크 단말기에서 직접 접근하므로
-- anon 키 및 인증 세션 모두 읽기/쓰기가 가능하도록 정책을 부여합니다.
ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backgrounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public access for templates" ON public.templates;
CREATE POLICY "Public access for templates" ON public.templates
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public access for backgrounds" ON public.backgrounds;
CREATE POLICY "Public access for backgrounds" ON public.backgrounds
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public access for app_config" ON public.app_config;
CREATE POLICY "Public access for app_config" ON public.app_config
    FOR ALL USING (true) WITH CHECK (true);

-- 5. Supabase Storage 버킷 생성 ('mediaart-assets')
-- 도안 및 고화질 배경 이미지를 보관하는 공개(Public) CDN 버킷
INSERT INTO storage.buckets (id, name, public)
VALUES ('mediaart-assets', 'mediaart-assets', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Storage 버킷 RLS 정책: 누구나 공개 읽기 및 파일 업로드/삭제 허용
DROP POLICY IF EXISTS "Public access for mediaart-assets read" ON storage.objects;
CREATE POLICY "Public access for mediaart-assets read" ON storage.objects
    FOR SELECT USING (bucket_id = 'mediaart-assets');

DROP POLICY IF EXISTS "Public access for mediaart-assets insert" ON storage.objects;
CREATE POLICY "Public access for mediaart-assets insert" ON storage.objects
    FOR INSERT WITH CHECK (bucket_id = 'mediaart-assets');

DROP POLICY IF EXISTS "Public access for mediaart-assets update" ON storage.objects;
CREATE POLICY "Public access for mediaart-assets update" ON storage.objects
    FOR UPDATE USING (bucket_id = 'mediaart-assets');

DROP POLICY IF EXISTS "Public access for mediaart-assets delete" ON storage.objects;
CREATE POLICY "Public access for mediaart-assets delete" ON storage.objects
    FOR DELETE USING (bucket_id = 'mediaart-assets');

-- ====================================================================
-- 설정 완료 안내 메시지
-- ====================================================================
SELECT '🎉 MediaArt Live Sketch Supabase 설정이 성공적으로 완료되었습니다!' AS status;
