import React, { useState, useEffect } from 'react';
import ReportForm from './components/ReportForm';
import { SuccessView } from './components/SuccessView';
import { Loader2 } from 'lucide-react';

const LOGO = import.meta.env.BASE_URL + 'logo.png';

export default function App() {
  const [currentUser, setCurrentUser] = useState<any>(() => {
    const saved = localStorage.getItem('currentUser');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        return null;
      }
    }
    return null;
  });
  const [isAuthenticating, setIsAuthenticating] = useState(() => {
    // If we detect Feishu or Lark in the User Agent, start as true to show the loading screen directly and avoid flashing the login card.
    return typeof navigator !== 'undefined' && /Feishu|Lark/i.test(navigator.userAgent);
  });
  const [authError, setAuthError] = useState<string | null>(null);
  const [manualName, setManualName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [view, setView] = useState<'form' | 'success'>('form');
  const [successData, setSuccessData] = useState<{recordId: string, handoverCode: string, itemCode: string} | null>(null);

  useEffect(() => {
    // Sync login state across tabs / iframe and popup
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'currentUser') {
        if (e.newValue) {
          try {
            setCurrentUser(JSON.parse(e.newValue));
          } catch (err) {
            console.error(err);
          }
        } else {
          setCurrentUser(null);
        }
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  // Feishu / Lark silent authentication inside Feishu Client App
  useEffect(() => {
    // Detect if we are running inside Feishu or Lark client
    const isFeishuClient = /Feishu|Lark/i.test(navigator.userAgent) ||
                          typeof (window as any).h5sdk !== 'undefined' ||
                          typeof (window as any).tt !== 'undefined';

    // If in Feishu client but stored user is mock/manual, clear it and re-authenticate
    if (isFeishuClient && currentUser && (currentUser.isMock || currentUser.isManual)) {
      console.log('Feishu client detected but user is mock/manual, clearing and re-authenticating...');
      localStorage.removeItem('currentUser');
      setCurrentUser(null);
      return;
    }

    if (currentUser) return;

    if (isFeishuClient) {
      console.log("Detected Feishu client environment. Initiating silent authentication...");
      setIsAuthenticating(true);
      setAuthError(null);
      let attempts = 0;

      const doSilentAuth = () => {
        const h5sdk = (window as any).h5sdk;
        const tt = (window as any).tt;

        if (h5sdk) {
          // 1. Get JSAPI signature from backend
          const currentUrl = window.location.href.split('#')[0];
          fetch('/api/feishu/jsapi-config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: currentUrl })
          })
          .then(res => res.json())
          .then(jsapiConfig => {
            if (jsapiConfig.error) {
              throw new Error(jsapiConfig.error);
            }
            console.log('JSAPI config:', jsapiConfig);

            // 2. Configure H5 SDK
            h5sdk.config({
              appId: jsapiConfig.appId,
              timestamp: jsapiConfig.timestamp,
              nonceStr: jsapiConfig.nonceStr,
              signature: jsapiConfig.signature,
              jsApiList: ['requestAuthCode'],
              success() {
                console.log('h5sdk.config success');
              },
              fail(err: any) {
                console.error('h5sdk.config failed:', err);
                setAuthError('飞书 H5 SDK 鉴权失败: ' + (err?.errMsg || JSON.stringify(err)));
                setIsAuthenticating(false);
              }
            });

            // 3. After SDK is ready, request auth code
            h5sdk.ready(() => {
              console.log('h5sdk.ready fired');
              tt.requestAuthCode({
                appId: jsapiConfig.appId,
                success(info: { code: string }) {
                  console.log('Feishu silent auth code obtained successfully:', info.code);
                  fetch('/api/feishu/auth', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ code: info.code })
                  })
                  .then(res => res.json())
                  .then(data => {
                    if (data.success && data.user) {
                      const user = {
                        name: data.user.name,
                        avatar: data.user.avatar_url,
                        role: 'receptionist',
                        openId: data.user.open_id,
                        unionId: data.user.union_id,
                        userId: data.user.user_id
                      };
                      localStorage.setItem('currentUser', JSON.stringify(user));
                      setCurrentUser(user);
                      console.log('Successfully logged in inside Feishu as:', user.name);
                    } else {
                      console.error('Feishu silent login backend error:', data.error);
                      setAuthError('飞书免登后端错误: ' + (data.error || '未知错误'));
                      setIsAuthenticating(false);
                    }
                  })
                  .catch(err => {
                    console.error('Feishu silent login fetch failed:', err);
                    setAuthError('与后台通讯失败: ' + err.message);
                    setIsAuthenticating(false);
                  });
                },
                fail(err: any) {
                  console.error('Feishu tt.requestAuthCode failed:', err);
                  setAuthError(`获取授权码失败: ${err?.errMsg || JSON.stringify(err)}。请确认在飞书开放平台-安全设置中将此域名添加到“H5应用安全域名/可信域名”，并在飞书客户端中打开此应用。`);
                  setIsAuthenticating(false);
                }
              });
            });
          })
          .catch(err => {
            console.error('Failed to load Feishu JSAPI config:', err);
            setAuthError('加载飞书 JSAPI 配置失败: ' + err.message);
            setIsAuthenticating(false);
          });
        } else if (attempts < 30) {
          attempts++;
          // Retry in case script is still loading
          setTimeout(doSilentAuth, 200);
        } else {
          console.warn('Feishu/Lark H5 SDK could not be loaded after 30 attempts.');
          setAuthError('未检测到飞书/Lark客户端 H5 JS-SDK 运行环境。如果您在外部浏览器，请等待自动跳转。');
          setIsAuthenticating(false);
        }
      };

      doSilentAuth();
    } else {
      // Running in a standard browser (like the AI Studio builder preview iframe)
      // Automatically bypass manual login with a mock test user so the user never sees any login prompt.
      console.log("Running outside of Feishu. Automatically logging in with test receptionist account.");
      const mockUser = {
        name: '测试客服(外部浏览器)',
        avatar: '',
        role: 'receptionist',
        isMock: true
      };
      localStorage.setItem('currentUser', JSON.stringify(mockUser));
      setCurrentUser(mockUser);
      setIsAuthenticating(false);
    }
  }, [currentUser]);
  
  const handleReportSubmit = async (item: any) => {
    setIsSubmitting(true);
    try {
      const payload = { ...item, finderName: currentUser?.name || '未知操作员', finderOpenId: currentUser?.openId || '' };
      const response = await fetch('/api/feishu/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const data = await response.json();
      
      if (response.ok && data.success) {
         setSuccessData({
           recordId: data.data.record.record_id,
           handoverCode: data.handoverCode,
           itemCode: data.itemCode
         });
         setView('success');
      } else {
         alert('上报失败：' + (data.error || '未知错误') + '\n\n请联系管理员检查后台配置（App Token 和 Table ID）。');
      }
    } catch (error) {
      alert('网络请求失败：' + error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    setSuccessData(null);
    setView('form');
  };

  if (isAuthenticating) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center">
        <Loader2 className="w-10 h-10 text-blue-500 animate-spin mb-4" />
        <p className="text-slate-600 font-medium">正在登录飞书...</p>
      </div>
    );
  }

  if (!currentUser) {
    const handleManualLogin = (e: React.FormEvent) => {
      e.preventDefault();
      if (!manualName.trim()) {
        alert('请输入姓名');
        return;
      }
      const user = {
        name: manualName.trim() + ' (手动登记)',
        avatar: '',
        role: 'receptionist',
        isManual: true
      };
      localStorage.setItem('currentUser', JSON.stringify(user));
      setCurrentUser(user);
    };

    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4 sm:p-6 relative">
        {/* Ambient background decoration */}
        <div className="absolute top-0 inset-x-0 h-48 bg-gradient-to-b from-red-600/10 to-transparent -z-10"></div>
        <div className="absolute -top-32 -right-32 w-80 h-80 bg-red-400 rounded-full mix-blend-multiply filter blur-[80px] opacity-20"></div>

        <div className="w-full max-w-md bg-white rounded-3xl shadow-xl p-8 border border-slate-100 relative">
          <div className="flex items-center justify-center w-20 h-20 bg-white rounded-3xl shadow-lg border border-slate-100 mx-auto mb-6">
            <img src={LOGO} alt="胡大 Logo" className="w-full h-full object-contain p-2" />
          </div>
          
          <h1 className="text-2xl font-extrabold text-slate-900 mb-2 text-center">顾客遗失物品管理系统</h1>
          
          <div className="bg-red-50/50 rounded-2xl p-4 border border-red-100/50 mb-6 text-left">
            <div className="flex items-start gap-2.5">
              <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-red-500 mt-2"></span>
              <div>
                <p className="text-red-700 text-sm font-semibold mb-1">自动获取飞书账号失败</p>
                {authError ? (
                  <div className="mt-1.5 bg-slate-50 border border-slate-100 p-2 rounded-lg text-[10px] font-mono text-slate-500 leading-normal max-h-24 overflow-y-auto break-all">
                    {authError}
                  </div>
                ) : (
                  <p className="text-slate-500 text-xs leading-normal">
                    请确认您是在飞书或Lark客户端内置浏览器中打开此应用，并且该应用已获得“获取当前员工基本信息”的飞书API权限。
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Manual Login Fallback Area */}
          <form onSubmit={handleManualLogin} className="bg-slate-50/80 rounded-2xl p-5 border border-slate-100 text-left mb-6">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 bg-amber-500 rounded-full"></span>
              应急临时通道
            </h3>
            <p className="text-[11px] text-slate-500 leading-normal mb-3.5">
              如果飞书配置暂时存在问题，为了不影响值班登记工作，您可以在下方手动输入姓名直接进入系统：
            </p>
            <div className="space-y-2.5">
              <input
                type="text"
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                placeholder="请输入您的姓名 (如: 张三)"
                className="w-full px-4 py-2.5 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 bg-white"
              />
              <button
                type="submit"
                className="w-full py-2.5 text-xs font-bold bg-gradient-to-r from-red-600 to-red-700 text-white rounded-xl hover:from-red-700 hover:to-red-800 active:scale-[0.98] transition-all flex items-center justify-center gap-1 shadow-sm focus:outline-none"
              >
                使用临时姓名登录系统
              </button>
            </div>
          </form>
          
          <button
            onClick={() => window.location.reload()}
            className="w-full py-3 text-xs font-bold bg-slate-100 text-slate-800 rounded-2xl hover:bg-slate-200 active:scale-[0.98] transition-all flex items-center justify-center gap-2 focus:outline-none"
          >
            重新加载 / 检测免登
          </button>
          
          <div className="mt-6 pt-5 border-t border-slate-100 text-[10px] text-slate-400 text-center">
            仅限内部员工和值班接待人员登录使用
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-red-500/30 relative z-0 overflow-hidden">
      {/* Modern SaaS Header Background */}
      <div className="absolute top-0 inset-x-0 h-[45vh] bg-gradient-to-b from-red-600 to-red-800 -z-10">
        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-10 mix-blend-overlay"></div>
        <div className="absolute -top-32 -right-32 w-96 h-96 bg-red-400 rounded-full mix-blend-screen filter blur-[100px] opacity-60"></div>
        <div className="absolute top-10 -left-32 w-96 h-96 bg-orange-400 rounded-full mix-blend-screen filter blur-[100px] opacity-40"></div>
      </div>
      
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-24">
        <header className="mb-10 flex flex-col items-start">
          <div className="flex items-center gap-4 drop-shadow-sm">
            <div className="flex items-center justify-center w-14 h-14 bg-white rounded-full shadow-md shrink-0 overflow-hidden border-2 border-white">
              <img src={LOGO} alt="胡大" className="w-full h-full object-contain p-1" />
            </div>
            <h1 className="text-3xl md:text-4xl font-extrabold text-white tracking-tight">
              顾客遗失物品登记单
            </h1>
          </div>
        </header>

        <main>
          <div className="bg-white/95 backdrop-blur-xl rounded-[2.5rem] shadow-2xl shadow-red-900/10 p-6 sm:p-10 md:p-12 border border-white relative">
            {/* Decorative element inside card */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-red-50 to-orange-50 rounded-full blur-3xl -z-10 transform translate-x-1/2 -translate-y-1/2"></div>
            
            {view === 'form' ? (
              <ReportForm 
                currentUser={currentUser}
                onSubmit={handleReportSubmit}
                onCancel={() => console.log('Cancelled')}
                isSubmitting={isSubmitting}
              />
            ) : (
              successData && <SuccessView data={successData} onBack={resetForm} />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
