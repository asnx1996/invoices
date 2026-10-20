-- نقل عيّنة من إكسترا القديم (Nizar2024) للجديد (XtrDB11_10_2026): وكلاء + حساباتهم، ومجموعتين مواد + موادها.
-- يتشغل بـ sqlcmd على النسخة الرئيسية (-v COMMIT=1 للحفظ، وبدونها يجرب ويرجّع كلشي).
-- الأعمدة المشتركة تنسخ كما هي، والروابط لجداول ما انتقلت (عملات، مراكز كلفة، تصنيفات...) تصير NULL.
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET QUOTED_IDENTIFIER ON;
USE XtrDB11_10_2026;
GO

CREATE OR ALTER PROCEDURE #copy @tbl sysname, @where nvarchar(max), @over nvarchar(max) AS
BEGIN
  -- @over: 'عمود=تعبير;عمود=تعبير' (التعبير يشوف صف المصدر باسم s)
  DECLARE @o TABLE (col sysname, expr nvarchar(max));
  INSERT @o SELECT LTRIM(LEFT(value, CHARINDEX('=', value) - 1)), SUBSTRING(value, CHARINDEX('=', value) + 1, 4000)
    FROM STRING_SPLIT(@over, ';') WHERE CHARINDEX('=', value) > 0;
  DECLARE @cols nvarchar(max), @vals nvarchar(max);
  SELECT @cols = STRING_AGG(CAST(QUOTENAME(d.name) AS nvarchar(max)), ','),
         @vals = STRING_AGG(CAST(COALESCE(o.expr,
           -- عمود إلزامي بالجديد وفارغ بالقديم: ناخذ القيمة الافتراضية مال الجديد
           CASE WHEN d.is_nullable = 0 AND dc.definition IS NOT NULL THEN 'ISNULL(s.' + QUOTENAME(d.name) + ', ' + dc.definition + ')' END,
           's.' + QUOTENAME(d.name)) AS nvarchar(max)), ',')
    FROM sys.columns d
    LEFT JOIN @o o ON o.col = d.name COLLATE DATABASE_DEFAULT
    LEFT JOIN sys.default_constraints dc ON dc.object_id = d.default_object_id
   WHERE d.object_id = OBJECT_ID(@tbl) AND d.is_identity = 0 AND d.is_computed = 0
     AND (o.col IS NOT NULL OR EXISTS (SELECT 1 FROM Nizar2024.sys.columns c
            WHERE c.object_id = OBJECT_ID('Nizar2024.dbo.' + @tbl) AND c.name COLLATE DATABASE_DEFAULT = d.name));
  DECLARE @sql nvarchar(max) = N'INSERT INTO dbo.' + QUOTENAME(@tbl) + N' (' + @cols + N') SELECT ' + @vals
    + N' FROM Nizar2024.dbo.' + QUOTENAME(@tbl) + N' s WHERE ' + @where
    + N' AND NOT EXISTS (SELECT 1 FROM dbo.' + QUOTENAME(@tbl) + N' x WHERE x.CardGuide = s.CardGuide)';
  EXEC sp_executesql @sql;
  PRINT @tbl + N': ' + CAST(@@ROWCOUNT AS nvarchar(20));
END
GO

BEGIN TRANSACTION;

-- العيّنة: 10 زبائن (تحت حساب 121) الأكثر حركة، ومجموعتين مواد بـ 10 مواد لكل وحدة
SELECT TOP 10 a.CardGuide, a.AccountID INTO #ag
  FROM Nizar2024.dbo.TBL016 a
  JOIN Nizar2024.dbo.TBL004 acc ON acc.CardGuide = a.AccountID
  JOIN Nizar2024.dbo.TBL004 p ON p.CardGuide = acc.MainAccount AND p.CardCode = '121'
 WHERE a.NotActive = 0
 ORDER BY (SELECT COUNT(*) FROM Nizar2024.dbo.TBL012 e WHERE e.AgentGuide = a.CardGuide) DESC;

SELECT g.CardGuide INTO #grp FROM Nizar2024.dbo.TBL006 g WHERE g.CardCode IN ('13', 'AQ');
SELECT i.CardGuide INTO #it FROM (
  SELECT CardGuide, ROW_NUMBER() OVER (PARTITION BY GroupGuid ORDER BY CardCode) n
    FROM Nizar2024.dbo.TBL007 WHERE GroupGuid IN (SELECT CardGuide FROM #grp) AND NotActive = 0) i
 WHERE i.n <= 10;

DECLARE @cust uniqueidentifier = (SELECT CardGuide FROM dbo.TBL004 WHERE CardCode = '121');
DECLARE @root uniqueidentifier = (SELECT TOP 1 CardGuide FROM dbo.TBL006 WHERE MainGuide IS NULL ORDER BY ID);
IF @cust IS NULL OR @root IS NULL THROW 50000, N'ما لكيت حساب الزبائن 121 أو المجموعة الرئيسية بالقاعدة الجديدة', 1;

-- 1) حسابات الوكلاء: تحت "الزبائن" بالجديد، والحساب الختامي نفسه مال الزبائن
DECLARE @w nvarchar(max) = N's.CardGuide IN (SELECT AccountID FROM #ag)';
DECLARE @ov nvarchar(max) =
  N'MainAccount=''' + CAST(@cust AS nvarchar(36)) + N''';ClosingAccount=(SELECT ClosingAccount FROM dbo.TBL004 WHERE CardCode=''121'');'
  + N'DefaultCurrency=NULL;DefaultCostCenter=NULL;DefaultBranch=NULL;DefaultProject=NULL;Item_ID=NULL;ByUser=NULL;ByGroup=NULL';
EXEC #copy 'TBL004', @w, @ov;

-- 2) الوكلاء
SET @ov = N'DefaultCurrency=NULL;CashAccountID=NULL;TaxAccountID=NULL;Project=NULL;Branch=NULL;MainAgent=NULL;MainAgent2=NULL;MainGroupGuide=NULL;'
  + N'CostCenter=NULL;CostCenter2=NULL;Warehouse=NULL;RelatedAdministration=NULL;RelatedAdministration2=NULL;RelatedAdministration3=NULL;'
  + N'Category01=NULL;Category02=NULL;Category03=NULL;Category04=NULL;Category05=NULL;Category06=NULL;Category07=NULL;Category08=NULL;'
  + N'Category09=NULL;Category10=NULL;Category11=NULL;Category12=NULL;Category13=NULL;Category14=NULL;Category15=NULL;'
  + N'ByUser=NULL;ByGroup=NULL;AddressID=NULL;RegionID=NULL;DueAgeType=NULL;PaymentTerm=NULL';
EXEC #copy 'TBL016', N's.CardGuide IN (SELECT CardGuide FROM #ag)', @ov;

-- 3) مجموعات المواد: تحت المجموعة الرئيسية بالجديد وبنفس حساباتها
SET @ov = N'MainGuide=''' + CAST(@root AS nvarchar(36)) + N''';'
  + N'MainAccount=(SELECT MainAccount FROM dbo.TBL006 WHERE CardGuide=''' + CAST(@root AS nvarchar(36)) + N''');'
  + N'TradingClosing=(SELECT TradingClosing FROM dbo.TBL006 WHERE CardGuide=''' + CAST(@root AS nvarchar(36)) + N''');'
  + N'BalanceSheetClosing=(SELECT BalanceSheetClosing FROM dbo.TBL006 WHERE CardGuide=''' + CAST(@root AS nvarchar(36)) + N''');BarcodeType=NULL;ByUser=NULL;ByGroup=NULL';
EXEC #copy 'TBL006', N's.CardGuide IN (SELECT CardGuide FROM #grp)', @ov;

-- 4) المواد (الأسعار تبقى أرقام، عملاتها فارغة = عملة البرنامج الأساسية)
SET @ov = N'DefaultCurrency=NULL;AccountID=NULL;RelatedAgent=NULL;AgentPriceCurrency=NULL;WholePriceCurrency=NULL;EndUserPriceCurrency=NULL;'
  + N'Price5ItemCurrency=NULL;Price6ItemCurrency=NULL;Price7ItemCurrency=NULL;StanderCostCurrency=NULL;'
  + N'Category01=NULL;Category02=NULL;Category03=NULL;Category04=NULL;Category05=NULL;ByUser=NULL;ByGroup=NULL;DefaultVariableUnit=NULL';
EXEC #copy 'TBL007', N's.CardGuide IN (SELECT CardGuide FROM #it)', @ov;

SELECT N'agents' k, COUNT(*) n FROM dbo.TBL016 UNION ALL SELECT N'items', COUNT(*) FROM dbo.TBL007
UNION ALL SELECT N'groups', COUNT(*) FROM dbo.TBL006 UNION ALL SELECT N'accounts', COUNT(*) FROM dbo.TBL004;

IF '$(COMMIT)' = '1' BEGIN COMMIT; PRINT N'✓ انحفظ' END
ELSE BEGIN ROLLBACK; PRINT N'• تجربة فقط — رجع كلشي' END
GO
